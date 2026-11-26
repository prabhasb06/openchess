import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Chess } from "chess.js";
import { stockfishPath } from "../server.mjs";
import { mobileBots } from "../src/android/local-bots.js";
import { botSearch, chooseOpponentMove } from "../src/android/offline-opponents.js";

const openings = [
  ["Italian Game", "1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 *"],
  ["Sicilian Defense", "1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 *"],
  ["Queen's Gambit", "1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Nf3 Be7 *"],
];
const pairs = [["Pebble", "Signal"], ["Signal", "Vector"], ["Vector", "Apex"]];
const maxPlies = 240;

function seeded(seed) {
  return () => ((seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 2 ** 32);
}

async function withStockfish(run) {
  const child = spawn(stockfishPath, [], {stdio:["pipe", "pipe", "inherit"]});
  await once(child, "spawn");
  const output = createInterface({input:child.stdout});
  const lines = output[Symbol.asyncIterator]();
  let name;
  const send = command => child.stdin.write(command + "\n");
  async function readUntil(predicate) {
    const timeout = setTimeout(() => child.kill(), 30000);
    try {
      for (;;) {
        const {value, done} = await lines.next();
        if (done) throw new Error("Stockfish closed its output during the benchmark.");
        if (predicate(value)) return value;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  try {
    send("uci");
    await readUntil(line => {
      if (line.startsWith("id name ")) name = line.slice(8);
      return line === "uciok";
    });
    send("setoption name Threads value 1");
    send("setoption name Hash value 16");
    return await run({
      name,
      async reset() {
        send("ucinewgame");
        send("isready");
        await readUntil(line => line === "readyok");
      },
      async analyze(board, {skill, multiPv, movetime, depth}) {
        send("setoption name Skill Level value " + skill);
        send("setoption name MultiPV value " + multiPv);
        send("isready");
        await readUntil(line => line === "readyok");
        send("position fen " + board.fen());
        send("go movetime " + movetime + (depth ? " depth " + depth : ""));
        const variations = new Map();
        const sign = board.turn() === "w" ? 1 : -1;
        const reply = await readUntil(line => {
          const info = line.match(/^info depth \d+.*?\bmultipv (\d+) score (cp|mate) (-?\d+).*?\bpv (.+)$/);
          if (info) {
            const score = Number(info[3]) * sign;
            variations.set(Number(info[1]), {
              score: info[2] === "cp" ? score / 100 : null,
              mate: info[2] === "mate" ? score : null,
              pv: info[4].split(" "),
            });
          }
          return line.startsWith("bestmove ");
        });
        return {bestmove:reply.split(" ")[1], lines:[...variations.values()]};
      },
    });
  } finally {
    if (!child.killed && child.exitCode === null) child.stdin.end("quit\n");
    output.close();
  }
}

async function playMatch(engine, opening, pgn, white, black, seed) {
  await engine.reset();
  const board = new Chess();
  board.loadPgn(pgn);
  board.setHeader("Event", "OpenChess bot match");
  board.setHeader("Opening", opening);
  board.setHeader("White", white.name);
  board.setHeader("Black", black.name);
  const firstPly = board.history().length;
  const random = {
    w:seeded(seed + mobileBots.indexOf(white)),
    b:seeded(seed + mobileBots.indexOf(black)),
  };
  let plies = firstPly;
  while (!board.isGameOver() && plies < maxPlies) {
    const color = board.turn();
    const profile = color === "w" ? white : black;
    const result = await engine.analyze(board, botSearch(profile, profile.skill));
    const move = chooseOpponentMove(board, result, profile, random[color]);
    assert.match(move, /^[a-h][1-8][a-h][1-8][qrbn]?$/);
    board.move({from:move.slice(0,2), to:move.slice(2,4), promotion:move[4]});
    plies++;
  }
  const result = board.isCheckmate() ? (board.turn() === "w" ? "0-1" : "1-0") :
    board.isDraw() ? "1/2-1/2" : "*";
  board.setHeader("Result", result);
  return {white:white.name, black:black.name, opening, result, plies, pgn:board.pgn()};
}

const suite = await Promise.all(pairs.map(([lower, higher]) => withStockfish(async engine => {
  const matchups = [lower, higher].map(name => mobileBots.find(bot => bot.name === name));
  const results = [];
  for (const [index, [opening, pgn]] of openings.entries()) {
    for (const colors of [matchups, [...matchups].reverse()]) {
      const game = await playMatch(engine, opening, pgn, ...colors, 738463 + index * 17);
      results.push(game);
      console.log(`${game.white} vs ${game.black} · ${opening} · ${game.result} · ${game.plies} plies`);
    }
  }
  return {engine:engine.name, lower, higher, results};
})));

for (const {engine, lower, higher, results} of suite) {
  const totals = {wins:0, draws:0, losses:0, unfinished:0};
  for (const game of results) {
    if (game.result === "*") totals.unfinished++;
    else if (game.result === "1/2-1/2") totals.draws++;
    else if ((game.result === "1-0" ? game.white : game.black) === higher) totals.wins++;
    else totals.losses++;
  }
  console.log(`${engine} · ${higher} against ${lower} · ${totals.wins} wins, ${totals.draws} draws, ${totals.losses} losses, ${totals.unfinished} unfinished`);
}

if (process.argv[2]) {
  const destination = resolve(process.argv[2]);
  await mkdir(dirname(destination), {recursive:true});
  await writeFile(destination, suite.flatMap(group => group.results.map(game => game.pgn)).join("\n\n") + "\n");
}
