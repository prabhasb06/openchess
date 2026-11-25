import { Crown, Share2, X } from "lucide-react";
import { localAvatar as avatar } from "./local-art";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { parseReviewPgn, runGameReview, REVIEW_VERSION } from "../review-model";
import { copyMobileText, saveMobileFile } from "../mobile-api";
import "./local-result.css";

const CACHE_KEY = "chess-local-reviews-v1";
function readCache() {
  try {
    const records = JSON.parse(localStorage.getItem(CACHE_KEY));
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}
function validCached(pgn) {
  return readCache().find(
    (record) =>
      record.version === REVIEW_VERSION &&
      record.pgn === pgn &&
      record.moves?.length &&
      record.counts?.w &&
      record.counts?.b &&
      record.accuracy &&
      record.moves.every(
        (move) => move.before && move.after && move.classification,
      ),
  );
}
function remember(report) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify(
        [
          report,
          ...readCache().filter((record) => record.pgn !== report.pgn),
        ].slice(0, 12),
      ),
    );
  } catch {
    /* A result must remain usable when storage is full. */
  }
}
function resultDetails(c) {
  const result = c.result || "";
  const token =
    c.game?.getHeaders?.().Result ||
    (result.startsWith("White")
      ? "1-0"
      : result.startsWith("Black")
        ? "0-1"
        : "1/2-1/2");
  const title =
    token === "1-0"
      ? "White Won"
      : token === "0-1"
        ? "Black Won"
        : token === "1/2-1/2"
          ? "Draw"
          : "Game Over";
  const reason = result
    .replace(/^(?:White|Black) wins? (?:by |on )?/i, "")
    .replace(/^Draw(?: by| —)?\s*/i, "");
  return {
    token,
    title,
    reason: reason ? reason[0].toUpperCase() + reason.slice(1) : result,
    winner: token === "1-0" ? "w" : token === "0-1" ? "b" : null,
  };
}

export function useResultAnalysis(pgn, enabled) {
  const pending = useRef(null);
  const generation = useRef(0);
  const [report, setReport] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState({ phase: "positions", completed: 0, total: 1, percent: 0 });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const id = ++generation.current,
      abort = new AbortController();
    pending.current = abort;
    setReport(null);
    setError("");
    setStatus("idle");
    let parsed;
    try {
      parsed = parseReviewPgn(pgn);
    } catch {
      return () => abort.abort();
    }
    const cached = validCached(parsed.pgn);
    if (cached) {
      setReport(cached);
      setStatus("complete");
      return () => abort.abort();
    }
    if (!enabled) return () => abort.abort();
    setStatus("running");
    setProgress({ phase: "positions", completed: 0, total: parsed.positions.length, percent: 0 });
    runGameReview(parsed.pgn, {
      signal: abort.signal,
      onProgress: (value) => {
        if (id === generation.current) setProgress(value);
      },
    })
      .then((next) => {
        if (abort.signal.aborted || id !== generation.current) return;
        remember(next);
        setReport(next);
        setStatus("complete");
      })
      .catch((failure) => {
        if (abort.signal.aborted || id !== generation.current) return;
        setStatus("error");
        setError(failure.message || "Stockfish is unavailable.");
      });
    return () => {
      abort.abort();
      if (pending.current === abort) pending.current = null;
    };
  }, [pgn, enabled, retry]);
  return {
    report,
    status,
    error,
    progress,
    abort: () => pending.current?.abort(),
    retry: () => setRetry((attempt) => attempt + 1),
  };
}

/**
 * Pass-and-play result content reconstructed from native 4.10.23 XML resources.
 * Classic card sizing/typography/actions are statically established. Full-screen
 * arrangement follows the preference description and shared avatar dimensions;
 * its runtime geometry/dynamic theme binding remain unobserved. No cloud rating,
 * Great Move/Miss scoring or confetti is fabricated.
 */
export function NativeLocalResult({
  controller: c,
  prefs = {},
  onClose,
  onReview,
  onAnalyze,
  onNewGame,
}) {
  const panel = useRef(null);
  const pgn = c.pgn || c.game?.pgn?.() || "";
  const details = resultDetails(c);
  const classic =
    prefs.gameOverScreen === "compact" || prefs.gameOverScreen === "classic";
  const [notice, setNotice] = useState("");
  const { report, status, error, progress, abort, retry } = useResultAnalysis(pgn, prefs.quickAnalysis !== false);
  useLayoutEffect(() => {
    const previous = document.activeElement;
    panel.current?.focus({ preventScroll: true });
    const close = (event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      onClose?.();
    };
    const key = (event) => {
      if (event.key === "Escape") return close(event);
      if (event.key !== "Tab") return;
      const controls = [
        ...panel.current.querySelectorAll("button:not(:disabled),a[href]"),
      ];
      const first = controls[0],
        last = controls.at(-1);
      if (document.activeElement === panel.current) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus({ preventScroll: true });
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus({ preventScroll: true });
      }
    };
    window.addEventListener("chess-native-back", close);
    document.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("chess-native-back", close);
      document.removeEventListener("keydown", key);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [onClose]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 2600);
    return () => clearTimeout(timer);
  }, [notice]);
  function act(action, ...args) {
    abort();
    action?.(...args);
  }
  async function share() {
    if (saveMobileFile("chess-local-game.pgn", pgn)) {
      setNotice("Choose where to save the PGN.");
      return;
    }
    const copied = await copyMobileText(pgn);
    setNotice(
      copied
        ? "PGN copied. Paste it to share this game."
        : "Use Analysis to export this game’s PGN.",
    );
  }
  const names = c.game?.getHeaders?.() || {};
  const totalBlunders = report
    ? (report.counts.w.Blunder || 0) + (report.counts.b.Blunder || 0)
    : "—";
  const hasMoves = !!(c.moves?.length || c.game?.history?.().length);
  const format = (seconds) =>
    seconds
      ? `${Math.floor(seconds / 60)} min${c.increment ? ` | ${c.increment}` : ""}`
      : "No Timer";
  return (
    <div
      className={`am-local-result-cover ${classic ? "is-classic" : "is-full"}`}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) act(onClose);
      }}
    >
      <section
        className="am-local-result"
        role="dialog"
        aria-modal="true"
        aria-label="Game over"
        tabIndex={-1}
        ref={panel}
        data-result-mode={classic ? "classic" : "full"}
      >
        <header className="am-local-result-heading">
          <button aria-label="Close game result" onClick={() => act(onClose)}>
            <X aria-hidden="true" />
          </button>
          <div>
            <h1>{details.title}</h1>
            <p>{details.reason}</p>
          </div>
          <button aria-label="Share game PGN" onClick={share}>
            <Share2 aria-hidden="true" />
          </button>
        </header>
        {!classic && (
          <div className="am-local-result-players">
            {["w", "b"].map((color) => (
              <div
                key={color}
                className={details.winner === color ? "is-winner" : ""}
              >
                <div className="am-local-result-avatar">
                  <img src={avatar} alt="" />
                  {details.winner === color && (
                    <span aria-label="Winner">
                      <Crown aria-hidden="true" />
                    </span>
                  )}
                </div>
                <strong>
                  {names[color === "w" ? "White" : "Black"] ||
                    (color === "w" ? "White" : "Black")}
                </strong>
              </div>
            ))}
            <span
              className="am-local-result-score"
              aria-label={`Game result: ${details.token}`}
            >
              {details.token === "1/2-1/2" ? "½–½" : details.token}
            </span>
            <small>{format(c.timeControl)} · Play in Person</small>
          </div>
        )}
        <div className="am-local-result-content">
          <section
            className="am-local-result-analysis"
            aria-label="Quick analysis"
          >
            <div className="am-local-result-counters">
              <div style={{ "--result-counter": "#749bbf" }}>
                <b title="The local model does not score Great Moves">—</b>
                <span>Great Moves</span>
              </div>
              <div style={{ "--result-counter": "#ff7769" }}>
                <b title="The local model does not score Misses">—</b>
                <span>Misses</span>
              </div>
              <div style={{ "--result-counter": "#fa412d" }}>
                <b aria-label={`Local estimated blunders: ${totalBlunders}`}>
                  {totalBlunders}
                </b>
                <span>Blunders</span>
              </div>
            </div>
            {status === "running" ? (
              <div className="am-local-result-progress" role="status">
                <progress
                  aria-label="Quick analysis progress"
                  value={progress.percent}
                  max="100"
                />
                <span>
                  {progress.phase === "positions" ? "Analyzing positions" : "Checking moves"}
                  {" · "}{progress.completed}/{progress.total}
                </span>
              </div>
            ) : status === "error" ? (
              <div className="am-local-result-error" role="status">
                <span title={error}>
                  Stockfish couldn’t analyze this game.
                </span>
                <button onClick={retry}>
                  Retry
                </button>
              </div>
            ) : (
              <p className="am-local-result-analysis-note">
                {report
                  ? "Local Stockfish estimates"
                  : "Game Review uses your paired engine"}
              </p>
            )}
            <p className="am-local-result-score-note">
              Great Moves and Misses are unavailable in the local model.
            </p>
            <button
              className="am-local-result-analysis-link"
              onClick={() =>
                act(
                  onAnalyze,
                  c.game.fen(),
                  pgn,
                  c.moves?.length || c.game.history().length,
                )
              }
              disabled={!onAnalyze}
            >
              Analysis
            </button>
          </section>
          <button
            className="am-local-result-review"
            onClick={() => act(onReview, pgn)}
            disabled={!onReview || !hasMoves}
          >
            Game Review
          </button>
          <div className="am-local-result-options">
            <button
              onClick={() => act(onNewGame, { rematch: true })}
              disabled={!onNewGame}
            >
              Rematch
            </button>
            <button
              onClick={() => act(onNewGame, { rematch: false })}
              disabled={!onNewGame}
            >
              New Game
            </button>
          </div>
        </div>
        {notice && (
          <div className="am-local-result-notice" role="status">
            {notice}
          </div>
        )}
      </section>
    </div>
  );
}
