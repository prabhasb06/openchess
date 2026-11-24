import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync, createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { createRulesGame, validateRulesPosition } from "./src/chess-rules.js";

const root = path.dirname(fileURLToPath(import.meta.url));
// Reuse the existing installation. This application never acquires an engine.
export const stockfishPath = process.env.STOCKFISH_PATH
  ? path.resolve(process.env.STOCKFISH_PATH)
  : path.resolve(root, "stockfish.exe");
const dist = path.join(root, "dist");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".wasm": "application/wasm",
  ".riv": "application/octet-stream",
};
let activeSearches = 0;
const children = new Set();

class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function validateSearch(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ApiError("Send a JSON object.");
  if (typeof input.fen !== "string" || input.fen.length > 200)
    throw new ApiError("A valid FEN position is required.");
  const variant = input.variant === undefined ? "standard" : input.variant;
  if (!["standard", "chess960"].includes(variant))
    throw new ApiError("variant must be standard or chess960.");
  let position;
  try {
    position = validateRulesPosition(input.fen, variant);
  } catch {
    throw new ApiError("The FEN position is invalid.");
  }
  // Stockfish expects one legal king per side and must never receive commands in FEN.
  if (/[\r\n]/.test(input.fen))
    throw new ApiError("The FEN position is invalid.");
  const bounded = (name, fallback, min, max) => {
    const value = input[name] ?? fallback;
    if (!Number.isInteger(value) || value < min || value > max)
      throw new ApiError(`${name} must be an integer from ${min} to ${max}.`);
    return value;
  };
  const rootMove = input.rootMove;
  if (rootMove !== undefined && (typeof rootMove !== "string" ||
      !position.moves({ verbose: true }).some(move => move.from + move.to + (move.promotion || "") === rootMove)))
    throw new ApiError("The requested root move is not legal.");
  return {
    fen: position.fen(),
    variant,
    turn: position.turn(),
    movetime: bounded("movetime", 500, 50, 3000),
    skill: bounded("skill", 10, 0, 20),
    multiPv: bounded("multiPv", 1, 1, 3),
    depth: bounded("depth", 0, 0, 24),
    rootMove,
  };
}

export async function analyzePosition(input, signal) {
  const options = validateSearch(input);
  if (!existsSync(stockfishPath))
    throw new ApiError(
      "The existing Stockfish installation could not be found.",
      503,
    );
  if (activeSearches >= 2)
    throw new ApiError(
      "The engine is busy. Please try again in a moment.",
      429,
    );
  if (signal?.aborted) throw new ApiError("Search cancelled.", 499);
  activeSearches++;
  return new Promise((resolve, reject) => {
    let child,
      timer,
      settled = false,
      buffer = "",
      started = false;
    const lines = new Map();
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      activeSearches--;
      if (child) {
        children.delete(child);
        child.stdin?.end("quit\n");
        child.kill();
      }
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => finish(new ApiError("Search cancelled.", 499));
    const send = (command) => {
      if (!settled && child.stdin.writable) child.stdin.write(command + "\n");
    };
    try {
      child = spawn(stockfishPath, [], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      finish(new ApiError("Stockfish could not start.", 503));
      return;
    }
    children.add(child);
    timer = setTimeout(
      () =>
        finish(
          new ApiError("The engine search timed out. Please try again.", 504),
        ),
      options.movetime + 10000,
    );
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", () =>
      finish(new ApiError("Stockfish could not start.", 503)),
    );
    child.stdin.on("error", () =>
      finish(new ApiError("The engine connection closed.", 503)),
    );
    child.on("exit", () => {
      if (!settled)
        finish(
          new ApiError("The engine stopped before completing its search.", 503),
        );
    });
    child.stderr.on("data", () => {});
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 1000000) {
        finish(new ApiError("Engine output exceeded its limit.", 503));
        return;
      }
      let end;
      while (!settled && (end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (line === "uciok") {
          send("setoption name Threads value 1");
          send("setoption name Hash value 32");
          send(`setoption name Skill Level value ${options.skill}`);
          send(`setoption name MultiPV value ${options.multiPv}`);
          send(`setoption name UCI_Chess960 value ${options.variant === "chess960"}`);
          send("isready");
        } else if (line === "readyok" && !started) {
          started = true;
          send("ucinewgame");
          send(`position fen ${options.fen}`);
          send(`go movetime ${options.movetime}`
            + (options.depth ? ` depth ${options.depth}` : "")
            + (options.rootMove ? ` searchmoves ${options.rootMove}` : ""));
        } else if (line.startsWith("info ") && /\bpv\s/.test(line)) {
          const score = line.match(/\bscore (cp|mate) (-?\d+)/);
          const pv = line.match(/\bpv (.+)$/);
          if (!score || !pv) continue;
          const sign = options.turn === "w" ? 1 : -1;
          const index = Number(line.match(/\bmultipv (\d+)/)?.[1] ?? 1);
          lines.set(index, {
            pv: pv[1].trim().split(/\s+/),
            score: score[1] === "cp" ? (Number(score[2]) * sign) / 100 : null,
            mate: score[1] === "mate" ? Number(score[2]) * sign : null,
            depth: Number(line.match(/\bdepth (\d+)/)?.[1] ?? 0),
          });
        } else if (line.startsWith("bestmove ")) {
          const move = line.split(/\s+/)[1];
          const ordered = [...lines.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([, value]) => value);
          const best = ordered[0];
          const terminal = createRulesGame(options.fen, options.variant);
          finish(null, {
            bestmove: move === "(none)" || move === "0000" ? null : move,
            evaluation: best?.score ?? (terminal.isCheckmate() ? null : 0),
            mate: best?.mate ?? (terminal.isCheckmate() ? 0 : null),
            depth: best?.depth ?? 0,
            lines: ordered,
            engine: "Stockfish",
            variant: options.variant,
            scorePerspective: "white",
          });
        }
      }
    });
    send("uci");
  });
}

function json(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new ApiError("Use application/json for engine requests.", 415);
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 32768) throw new ApiError("Request body is too large.", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError("Request body must be valid JSON.");
  }
}

export function createAppServer({ lanToken = null } = {}) {
  return http.createServer(async (req, res) => {
    try {
      const origin = req.headers.origin;
      if (origin) {
        let parsed;
        try {
          parsed = new URL(origin);
        } catch {
          throw new ApiError("Origin is not allowed.", 403);
        }
        if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname))
          throw new ApiError("Origin is not allowed.", 403);
      }
      const url = new URL(req.url, "http://127.0.0.1");
      const address = req.socket.remoteAddress;
      const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
      if (url.pathname.startsWith("/api/") && !local) {
        const supplied = Buffer.from(String(req.headers["x-chess-token"] || ""));
        const expected = Buffer.from(lanToken || "");
        if (!expected.length || supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
          throw new ApiError("Pair this phone with the connection code shown on your PC.", 401);
      }
      if (url.pathname === "/download/chess-local.apk" && ["GET", "HEAD"].includes(req.method)) {
        const apk = path.join(root, "downloads", "chess-local.apk");
        if (!existsSync(apk)) throw new ApiError("The Android package has not been built yet.", 404);
        const info = await stat(apk);
        res.writeHead(200, { "Content-Type": "application/vnd.android.package-archive", "Content-Length": info.size, "Content-Disposition": 'attachment; filename="chess-local.apk"', "Cache-Control": "no-store" });
        if (req.method === "HEAD") res.end(); else createReadStream(apk).pipe(res);
        return;
      }
      if (url.pathname === "/api/health" && req.method === "GET") {
        json(res, 200, {
          ok: existsSync(stockfishPath),
          engine: "Stockfish",
          installation: stockfishPath,
          activeSearches,
        });
        return;
      }
      if (url.pathname === "/api/engine" && req.method === "POST") {
        const input = await readJson(req);
        const controller = new AbortController();
        res.on("close", () => {
          if (!res.writableEnded) controller.abort();
        });
        const result = await analyzePosition(input, controller.signal);
        if (!res.destroyed) json(res, 200, result);
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        json(res, 404, { error: "API endpoint not found." });
        return;
      }
      if (!["GET", "HEAD"].includes(req.method)) {
        json(res, 405, { error: "Method not allowed." });
        return;
      }
      let requested;
      try {
        requested = decodeURIComponent(url.pathname);
      } catch {
        throw new ApiError("Invalid URL.");
      }
      let target = path.resolve(dist, "." + requested);
      if (target !== dist && !target.startsWith(dist + path.sep))
        throw new ApiError("Invalid path.", 403);
      let info;
      try {
        info = await stat(target);
      } catch {}
      if (!info?.isFile()) {
        // Assets must fail clearly rather than returning HTML with a misleading MIME type.
        if (path.extname(requested)) {
          json(res, 404, { error: "File not found." });
          return;
        }
        target = path.join(dist, "index.html");
        try {
          info = await stat(target);
        } catch {
          json(res, 503, {
            error:
              "Build the frontend with npm run build, or start npm run dev.",
          });
          return;
        }
      }
      res.writeHead(200, {
        "Content-Type":
          MIME[path.extname(target)] ?? "application/octet-stream",
        "Content-Length": info.size,
        "Cache-Control": target.includes(path.sep + "assets" + path.sep)
          ? "public, max-age=31536000, immutable"
          : "no-cache",
        "X-Content-Type-Options": "nosniff",
      });
      if (req.method === "HEAD") res.end();
      else createReadStream(target).pipe(res);
    } catch (error) {
      if (!res.destroyed && !res.headersSent)
        json(res, error.status ?? 500, {
          error: error.status
            ? error.message
            : "An unexpected local server error occurred.",
        });
    }
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const port = Number(process.env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be a valid TCP port.");
  const host = process.env.HOST || "127.0.0.1";
  if (host !== "127.0.0.1" && !process.env.CHESS_LAN_TOKEN)
    throw new Error("Use start-mobile.cmd to share the engine with a paired phone.");
  const server = createAppServer({ lanToken: process.env.CHESS_LAN_TOKEN });
  server.listen(port, host, () =>
    console.log(
      `Local chess server: http://127.0.0.1:${port}\nExisting Stockfish: ${stockfishPath}`,
    ),
  );
  const shutdown = () => {
    for (const child of children) child.kill();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
