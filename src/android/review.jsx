import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRulesGame, STANDARD_FEN } from "../chess-rules.js";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Settings,
  Search,
  RotateCw,
  Lightbulb,
  Eye,
  X,
  Upload,
  Play,
  Pause,
} from "lucide-react";
import { Board } from "../Board.jsx";
import { sound, selectMoveSound } from "../audio.js";
import { playHistoryMoveSound } from "./history-sound.js";
import {
  parseReviewPgn,
  runGameReview,
  evaluationValue,
  REVIEW_VERSION,
  REVIEW_CLASSES,
} from "../review-model.js";
import { localCoach as coach } from "./local-art";
import { localCoachNames } from "./offline-opponents";
import "./chrome.css";
import "./review.css";

const CACHE = "chess-local-reviews-v1",
  SETTINGS = "chess-local-mobile-review-settings";
const icons = {
  Brilliant: "!!",
  Great: "!",
  Best: "★",
  Excellent: "✓",
  Good: "✓",
  Inaccuracy: "?!",
  Mistake: "?",
  Miss: "×",
  Blunder: "??",
  Forced: "•",
};
const colors = {
  Brilliant: "#5ce0d1",
  Great: "#91c9ff",
  Best: "#81b64c",
  Excellent: "#81b64c",
  Good: "#95b776",
  Inaccuracy: "#f7c631",
  Mistake: "#ffa459",
  Miss: "#ff9a89",
  Blunder: "#fa412d",
  Forced: "#999",
};
const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};
const isKey = (m) =>
  ["Brilliant", "Great", "Inaccuracy", "Mistake", "Miss", "Blunder"].includes(m.classification);
const score = (e) =>
  !e
    ? "—"
    : e.mate != null
      ? e.mate === 0
        ? "Mate"
        : `${e.mate > 0 ? "+" : "−"}M${Math.abs(e.mate)}`
      : `${(e.evaluation || 0) >= 0 ? "+" : ""}${(e.evaluation || 0).toFixed(2)}`;
const numeric = (e) => Math.max(-8, Math.min(8, e ? evaluationValue(e) : 0));
// Older cached records and suggested SAN lines may have no verbose flags.
const withReviewMoveFlags = (move) => ({ ...move,
  flags: move?.flags || (/^(?:O|0)-(?:O|0)-(?:O|0)/.test(move?.san || "") ? "q" : /^(?:O|0)-(?:O|0)/.test(move?.san || "") ? "k" : /=[QRBN]/.test(move?.san || "") ? "p" : /x/.test(move?.san || "") ? "c" : ""),
});

/** Dedicated portrait review, following documented mobile flows. Exact review
 * geometry is pending a corresponding official Android runtime capture. */
export function MobileReview({
  pgn = "",
  prefs = {},
  selectedCoach,
  onBack,
  onAnalyze,
  onPgnChange,
}) {
  const [draft, setDraft] = useState(pgn),
    [parsed, setParsed] = useState(null),
    [report, setReport] = useState(null);
  const [status, setStatus] = useState("idle"),
    [error, setError] = useState(""),
    [progress, setProgress] = useState({ phase: "positions", completed: 0, total: 1, percent: 0 });
  const [screen, setScreen] = useState("highlights"),
    [ply, setPly] = useState(0),
    [flipped, setFlipped] = useState(false),
    [filter, setFilter] = useState("both");
  const [retry, setRetry] = useState(false),
    [retryFen, setRetryFen] = useState(null),
    [feedback, setFeedback] = useState(""),
    [arrow, setArrow] = useState(false);
  const [lineIndex, setLineIndex] = useState(-1),
    [playing, setPlaying] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [coachDrag, setCoachDrag] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false),
    [settings, setSettings] = useState(() => ({
      showCoach: true,
      showEval: true,
      showArrows: true,
      autoplay: true,
      delay: 900,
      ...read(SETTINGS, {}),
    }));
  const [savedMessage, setSavedMessage] = useState("");
  const active = useRef(null),
    generation = useRef(0),
    notation = useRef(null),
    swipe = useRef(null),
    drag = useRef(null),
    suppressCoachClick = useRef(false),
    skipIncoming = useRef(null),
    settingsDialog = useRef(null),
    file = useRef(null);
  const data = report || parsed,
    current = report?.moves[ply - 1],
    selected = data?.moves[ply - 1];
  const variant = data?.variant || data?.headers?.Variant || "standard";
  const linePositions = useMemo(() => {
    if (!current) return [];
    const g = createRulesGame(current.before, variant),
      list = [g.fen()];
    for (const san of current.bestLine || []) {
      try {
        g.move(san);
        list.push(g.fen());
      } catch {
        break;
      }
    }
    return list;
  }, [current, variant]);
  const fen =
    retryFen ||
    (lineIndex >= 0 ? linePositions[lineIndex] : null) ||
    selected?.after ||
    data?.base ||
    STANDARD_FEN;
  const game = useMemo(() => createRulesGame(fen, variant), [fen, variant]);
  const evaluation =
    retry || lineIndex === 0
      ? current?.beforeEval
      : retryFen || lineIndex > 0
        ? null
        : ply
          ? current?.afterEval
          : report?.moves[0]?.beforeEval;
  const keys =
    report?.moves
      .map((m, i) => ({ ...m, ply: i + 1 }))
      .filter((m) => isKey(m) && (filter === "both" || filter === m.color)) ||
    [];
  const white = data?.headers?.White || "White",
    black = data?.headers?.Black || "Black";
  const reviewCoach = [parsed?.headers?.Coach, selectedCoach].find((name) =>
    localCoachNames.includes(name),
  );
  useEffect(() => write(SETTINGS, settings), [settings]);
  function clearPosition() {
    setRetry(false);
    setRetryFen(null);
    setFeedback("");
    setArrow(false);
    setLineIndex(-1);
    setPlaying(false);
    setCollapsed(false);
    setCoachDrag(0);
  }
  function rememberPgn(value) {
    if (onPgnChange && value !== pgn) {
      skipIncoming.current = value;
      onPgnChange(value);
    }
  }
  function consumeBack() {
    if (settingsOpen) {
      setSettingsOpen(false);
      return true;
    }
    if (retry || retryFen || lineIndex >= 0) {
      clearPosition();
      return true;
    }
    return false;
  }
  function go(value) {
    const next = Math.max(0, Math.min(data?.moves.length || 0, value));
    if (next !== ply && next > 0)
      playHistoryMoveSound(sound.play, withReviewMoveFlags(data.moves[next - 1]));
    clearPosition();
    setPly(next);
    setScreen("review");
  }
  async function start(value = draft, fresh = false) {
    active.current?.abort();
    const id = ++generation.current,
      controller = new AbortController();
    active.current = controller;
    setError("");
    setReport(null);
    setPly(0);
    setScreen("highlights");
    clearPosition();
    setSavedMessage("");
    let parsedGame;
    try {
      parsedGame = parseReviewPgn(value);
      setParsed(parsedGame);
      setDraft(parsedGame.pgn);
    } catch (e) {
      setParsed(null);
      setStatus("idle");
      setError(e.message);
      return;
    }
    const cache = read(CACHE, []);
    const cached =
      !fresh &&
      Array.isArray(cache) &&
      cache.find(
        (r) =>
          r.version === REVIEW_VERSION &&
          r.pgn === parsedGame.pgn &&
          r.moves?.length === parsedGame.moves.length &&
          r.counts?.w &&
          r.counts?.b &&
          r.accuracy &&
          r.moves.every((m) => m.before && m.after && m.classification),
      );
    if (cached) {
      setReport(cached);
      setStatus("complete");
      setSavedMessage("Saved review · available offline");
      rememberPgn(cached.pgn);
      return;
    }
    setStatus("running");
    setProgress({ phase: "positions", completed: 0, total: parsedGame.positions.length, percent: 0 });
    try {
      const next = await runGameReview(parsedGame.pgn, {
        signal: controller.signal,
        reuse: !fresh,
        onProgress: (p) => {
          if (id === generation.current) setProgress(p);
        },
      });
      if (controller.signal.aborted || id !== generation.current) return;
      setReport(next);
      setStatus("complete");
      setSavedMessage("Saved on this device");
      write(
        CACHE,
        [
          next,
          ...(Array.isArray(cache) ? cache : []).filter(
            (r) => r.pgn !== next.pgn,
          ),
        ].slice(0, 12),
      );
      rememberPgn(next.pgn);
    } catch (e) {
      if (id !== generation.current) return;
      setStatus(controller.signal.aborted ? "cancelled" : "error");
      if (!controller.signal.aborted)
        setError(
          e.message ||
            "Could not finish review. Check engine settings and retry.",
        );
    }
  }
  useEffect(() => {
    if (pgn === skipIncoming.current) skipIncoming.current = null;
    else if (pgn.trim()) start(pgn);
    return () => {
      generation.current++;
      active.current?.abort();
    };
  }, [pgn]);
  useEffect(() => {
    const back = (e) => {
      if (consumeBack()) e.preventDefault();
    };
    window.addEventListener("chess-native-back", back);
    return () => window.removeEventListener("chess-native-back", back);
  }, [settingsOpen, retry, retryFen, lineIndex]);
  useEffect(() => {
    if (!settingsOpen) return;
    const previous = document.activeElement;
    settingsDialog.current
      ?.querySelector("button")
      ?.focus({ preventScroll: true });
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [settingsOpen]);
  useEffect(() => {
    const key = (e) => {
      if (
        settingsOpen ||
        /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) ||
        e.target.isContentEditable ||
        !data ||
        status === "running"
      )
        return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        go(ply + (e.key === "ArrowLeft" ? -1 : 1));
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [ply, data, status, settingsOpen]);
  useEffect(() => {
    const panel = notation.current,
      row = panel?.querySelector('[aria-current="true"]');
    if (!row) return;
    const p = panel.getBoundingClientRect(),
      r = row.getBoundingClientRect();
    if (r.left < p.left) panel.scrollLeft += r.left - p.left;
    else if (r.right > p.right) panel.scrollLeft += r.right - p.right;
  }, [ply, screen]);
  useEffect(() => {
    if (!playing || lineIndex < 0 || lineIndex >= linePositions.length - 1) {
      if (playing) setPlaying(false);
      return;
    }
    const timer = setTimeout(() => {
      setLineIndex((i) => Math.min(i + 1, linePositions.length - 1));
      playSuggestedMove(lineIndex + 1);
    }, settings.delay);
    return () => clearTimeout(timer);
  }, [playing, lineIndex, linePositions, settings.delay, current]);
  function cancel() {
    generation.current++;
    active.current?.abort();
    setStatus("cancelled");
  }
  function nextKey() {
    const next = keys.find((m) => m.ply > ply) || keys[0];
    if (next) go(next.ply);
    else if (data) go(Math.min(ply + 1, data.moves.length));
  }
  function best() {
    if (!current) return;
    setRetry(false);
    setRetryFen(null);
    setLineIndex(0);
    setPlaying(false);
    setArrow(true);
    setFeedback(`Best: ${current.bestSan || "no legal continuation"}`);
  }
  function playSuggestedMove(index) {
    const san = current?.bestLine[index - 1];
    if (san) playHistoryMoveSound(sound.play, withReviewMoveFlags({ san }));
  }
  function showLine() {
    if (!current) return;
    if (lineIndex >= 0) {
      setLineIndex(-1);
      setPlaying(false);
      setArrow(false);
      return;
    }
    setRetry(false);
    setRetryFen(null);
    const first = Math.min(1, linePositions.length - 1);
    setLineIndex(first);
    playSuggestedMove(first);
    setPlaying(settings.autoplay);
    setArrow(false);
    setFeedback("Suggested continuation");
  }
  function beginRetry() {
    if (!current?.bestmove) return;
    clearPosition();
    setRetry(true);
    setRetryFen(current.before);
    setFeedback("Find the strongest move. Your original game stays unchanged.");
  }
  function retryMove(from, to, promotion = "q") {
    if (!retry || !current) return;
    const g = createRulesGame(current.before, variant);
    let made;
    try {
      made = g.move({ from, to, promotion });
    } catch {
      return;
    }
    if (from + to + (made.promotion || "") === current.bestmove) {
      setRetry(false);
      setRetryFen(g.fen());
      setArrow(false);
      setFeedback(`That's it! ${made.san} is the engine’s best move.`);
      sound.play(selectMoveSound(made));
    } else {
      setFeedback(
        `${made.san} is legal, but there is a stronger move. Try again.`,
      );
      sound.play("incorrect");
    }
  }
  async function importFile(e) {
    const selectedFile = e.target.files?.[0];
    e.target.value = "";
    if (!selectedFile) return;
    if (selectedFile.size > 200000) {
      setError("Choose a PGN file smaller than 200 KB.");
      return;
    }
    try {
      const value = await selectedFile.text();
      setDraft(value);
      await start(value);
    } catch {
      setError("Could not read this PGN file.");
    }
  }
  function analyze() {
    onAnalyze?.(
      fen,
      retryFen || lineIndex >= 0 ? "" : report?.pgn || "",
      retryFen || lineIndex >= 0 ? 0 : ply,
      report && (retryFen || lineIndex >= 0) ? {
        sourcePgn: report.pgn,
        beforePly: Math.max(0, ply - 1),
        continuation: (current?.bestLine || []).slice(0, lineIndex >= 0 ? lineIndex : retryFen === current?.before ? 0 : 1),
      } : undefined,
    );
  }
  const evaluations = report
    ? [report.moves[0].beforeEval, ...report.moves.map((m) => m.afterEval)]
    : [];
  const points = evaluations
    .map(
      (e, i) =>
        `${(i / Math.max(1, evaluations.length - 1)) * 400},${60 - numeric(e) * 6.4}`,
    )
    .join(" ");
  const graph = report && (
    <div className="am-review-graph" aria-label="Game advantage graph">
      <svg
        viewBox="0 0 400 120"
        preserveAspectRatio="none"
        role="img"
        aria-label="Evaluation graph, positive for White"
      >
        <path
          d={`M0 120L${points.replaceAll(" ", "L")}L400 120Z`}
          fill="#b7b6b2"
        />
        <line x1="0" x2="400" y1="60" y2="60" stroke="#ffffff40" />
        <polyline points={points} stroke="#fff" strokeWidth="2" fill="none" />
        <line
          x1={(ply / Math.max(1, evaluations.length - 1)) * 400}
          x2={(ply / Math.max(1, evaluations.length - 1)) * 400}
          y1="0"
          y2="120"
          stroke="#81b64c"
          strokeWidth="2"
        />
      </svg>
      <div>
        {evaluations.map((e, i) => (
          <button
            key={i}
            aria-label={`Review position ${i}, evaluation ${score(e)}`}
            title={`${i ? report.moves[i - 1].san : "Start"} · ${score(e)}`}
            onClick={() => go(i)}
          />
        ))}
      </div>
    </div>
  );
  return (
    <section className="am-review" data-mobile-review-status={status}>
      <header className="am-review-header">
        <button
          className="am-icon-button"
          onClick={() => {
            if (!consumeBack()) onBack?.();
          }}
          aria-label="Back from review"
        >
          <ArrowLeft />
        </button>
        <h1>Game Review</h1>
        <button
          className="am-icon-button"
          aria-label="Open self analysis"
          onClick={analyze}
          disabled={!report}
        >
          <Search />
        </button>
        <button
          className="am-icon-button"
          aria-label="Review settings"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings />
        </button>
      </header>
      {!report ? (
        <div className="am-review-import">
          <h2>
            {status === "running"
              ? "Reviewing your game…"
              : status === "cancelled"
                ? "Review paused"
                : "Learn from every move"}
          </h2>
          <p>Stockfish finds stronger moves and the moments that mattered.</p>
          {status === "running" ? (
            <>
              <progress aria-label="Review progress" max="100" value={progress.percent} />
              <p>
                {progress.phase === "positions" ? "Analyzing positions" : "Checking moves"}
                {" · "}{progress.completed} of {progress.total}
              </p>
              <button className="am-review-secondary" onClick={cancel}>
                Cancel review
              </button>
            </>
          ) : (
            <>
              <label htmlFor="mobile-review-pgn">Paste a PGN</label>
              <textarea
                id="mobile-review-pgn"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck="false"
                placeholder="1. e4 e5 2. Nf3 Nc6"
              />
              <button
                className="am-review-primary"
                disabled={!draft.trim()}
                onClick={() => start()}
              >
                {status === "error" ? "Retry Review" : "Start Review"}
              </button>
              <button
                className="am-review-secondary"
                onClick={() => file.current?.click()}
              >
                <Upload /> Import PGN file
              </button>
              <input
                ref={file}
                type="file"
                accept=".pgn,.txt,text/plain,application/x-chess-pgn"
                onChange={importFile}
                hidden
              />
            </>
          )}
          {error && (
            <p role="alert" className="am-review-error">
              {error}
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="am-review-tabs">
            <button
              className={screen === "highlights" ? "active" : ""}
              onClick={() => {
                clearPosition();
                setScreen("highlights");
              }}
            >
              Highlights
            </button>
            <button
              className={screen === "review" ? "active" : ""}
              onClick={() => setScreen("review")}
            >
              Review
            </button>
          </div>
          {screen === "highlights" ? (
            <div className="am-review-highlights">
              <h2>How did you play?</h2>
              <div className="am-review-players">
                {[
                  ["w", white],
                  ["b", black],
                ].map(([color, name]) => (
                  <div key={color}>
                    <span className={`am-review-dot ${color}`} />
                    <span>{name}</span>
                    <strong>{report.accuracy[color]?.toFixed(1) ?? "—"}</strong>
                  </div>
                ))}
              </div>
              <p className="am-review-estimate">Accuracy · local estimate</p>
              {graph}
              <div className="am-review-counts">
                {REVIEW_CLASSES.map((category) => (
                  <div key={category}>
                    <button
                      disabled={!report.counts.w[category]}
                      onClick={() =>
                        go(
                          report.moves.findIndex(
                            (m) =>
                              m.color === "w" && m.classification === category,
                          ) + 1,
                        )
                      }
                      aria-label={`White ${category} moves`}
                    >
                      {report.counts.w[category]}
                    </button>
                    <span style={{ color: colors[category] }}>
                      {icons[category]} {category}
                    </span>
                    <button
                      disabled={!report.counts.b[category]}
                      onClick={() =>
                        go(
                          report.moves.findIndex(
                            (m) =>
                              m.color === "b" && m.classification === category,
                          ) + 1,
                        )
                      }
                      aria-label={`Black ${category} moves`}
                    >
                      {report.counts.b[category]}
                    </button>
                  </div>
                ))}
              </div>
              <button
                className="am-review-primary"
                onClick={() => go(keys[0]?.ply || 1)}
              >
                Start Review
              </button>
              <p>{keys.length} key moments</p>
            </div>
          ) : (
            <>
              <div className="am-review-player">
                <span>♟</span>
                <strong>{flipped ? white : black}</strong>
                <button
                  onClick={() => setFlipped((v) => !v)}
                  aria-label="Flip review board"
                >
                  <RotateCw />
                </button>
              </div>
              {settings.showEval && (
                <div
                  className="am-review-eval"
                  title={`White evaluation: ${score(evaluation)}`}
                >
                  <div
                    style={{ width: `${50 + numeric(evaluation) * 5.7}%` }}
                  />
                  <span>{score(evaluation)}</span>
                </div>
              )}
              <Board
                game={game}
                prefs={{
                  ...prefs,
                  nativeMobile: true,
                  rotatePieces: false,
                  ...(retry ? { autoQueen: false } : {}),
                }}
                flipped={flipped}
                disabled={!retry}
                onMove={retryMove}
                lastMove={retryFen || lineIndex >= 0 ? null : selected}
                hint={
                  settings.showArrows && arrow && (retry || lineIndex === 0)
                    ? current?.bestmove
                    : null
                }
              />
              <div className="am-review-player">
                <span>♙</span>
                <strong>{flipped ? black : white}</strong>
                <small>
                  {ply}/{report.moves.length}
                </small>
              </div>
              <div className="am-review-notation">
                <button
                  aria-label="Previous review move"
                  onClick={() => go(ply - 1)}
                  disabled={!ply}
                >
                  <ChevronLeft />
                </button>
                <div
                  ref={notation}
                  onTouchStart={(e) => {
                    swipe.current = {
                      x: e.touches[0].clientX,
                      y: e.touches[0].clientY,
                    };
                  }}
                  onTouchEnd={(e) => {
                    const point = swipe.current;
                    swipe.current = null;
                    if (!point) return;
                    const dx = e.changedTouches[0].clientX - point.x,
                      dy = e.changedTouches[0].clientY - point.y;
                    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy))
                      go(ply + (dx < 0 ? 1 : -1));
                  }}
                >
                  {report.moves.map((m, i) => (
                    <button
                      key={i}
                      aria-current={ply === i + 1 ? "true" : undefined}
                      onClick={() => go(i + 1)}
                    >
                      <span>
                        {Number(m.before.split(" ")[5])}
                        {m.color === "w" ? "." : "…"}
                      </span>{" "}
                      {m.san}
                      <sup style={{ color: colors[m.classification] }}>
                        {icons[m.classification]}
                      </sup>
                    </button>
                  ))}
                </div>
                <button
                  aria-label="Next review move"
                  onClick={() => go(ply + 1)}
                  disabled={ply === report.moves.length}
                >
                  <ChevronRight />
                </button>
              </div>
              <div
                className={`am-review-coach ${collapsed ? "collapsed" : ""}`}
                style={{
                  transform: coachDrag
                    ? `translateY(${coachDrag}px)`
                    : undefined,
                }}
              >
                <button
                  className="am-review-coach-handle"
                  aria-label={
                    collapsed
                      ? "Expand coach explanation"
                      : "Drag coach explanation down"
                  }
                  onClick={() => {
                    if (suppressCoachClick.current) {
                      suppressCoachClick.current = false;
                      return;
                    }
                    setCollapsed((v) => !v);
                  }}
                  onPointerDown={(e) => {
                    drag.current = { y: e.clientY, pointer: e.pointerId };
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    if (drag.current?.pointer === e.pointerId)
                      setCoachDrag(
                        Math.min(160, Math.max(0, e.clientY - drag.current.y)),
                      );
                  }}
                  onPointerUp={(e) => {
                    if (drag.current?.pointer !== e.pointerId) return;
                    const moved = e.clientY - drag.current.y;
                    suppressCoachClick.current = Math.abs(moved) > 8;
                    drag.current = null;
                    if (moved > 70) setCollapsed(true);
                    setCoachDrag(0);
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  }}
                  onPointerCancel={() => {
                    drag.current = null;
                    setCoachDrag(0);
                  }}
                >
                  <span />
                </button>
                <div>
                  {settings.showCoach && (
                    <img
                      src={coach}
                      alt={reviewCoach ? `${reviewCoach}, coach` : "Coach illustration"}
                    />
                  )}
                  <article>
                    <h2 style={{ color: colors[current?.classification] }}>
                      {current
                        ? `${current.san} ${icons[current.classification]} ${current.classification}`
                        : "Your game, move by move"}
                    </h2>
                    {!collapsed && (
                      <>
                        <p>
                          {feedback ||
                            current?.explanation ||
                            "Use Next to explore the key moments in your game."}
                        </p>
                        {(reviewCoach || current) && (
                          <small>
                            {reviewCoach && <span>Coach {reviewCoach}</span>}
                            {reviewCoach && current && " · "}
                            {current && (
                              <>
                                {score(current.beforeEval)} →{" "}
                                {score(current.afterEval)} · White’s perspective
                              </>
                            )}
                          </small>
                        )}
                        {retry && (
                          <button
                            className="am-review-hint"
                            onClick={() => setArrow(true)}
                          >
                            <Lightbulb /> Hint
                          </button>
                        )}
                      </>
                    )}
                  </article>
                </div>
              </div>
              {lineIndex >= 0 && (
                <div className="am-review-line">
                  <b>{current.bestLine.join(" ")}</b>
                  <div>
                    <button
                      disabled={lineIndex === 0}
                      onClick={() => {
                        setPlaying(false);
                        setLineIndex((i) => i - 1);
                        playSuggestedMove(lineIndex - 1);
                      }}
                      aria-label="Previous suggested move"
                    >
                      <ChevronLeft />
                    </button>
                    <button
                      onClick={() => setPlaying((v) => !v)}
                      disabled={lineIndex >= linePositions.length - 1}
                      aria-label={
                        playing ? "Pause suggested line" : "Play suggested line"
                      }
                    >
                      {playing ? <Pause /> : <Play />}
                    </button>
                    <button
                      disabled={lineIndex >= linePositions.length - 1}
                      onClick={() => {
                        setPlaying(false);
                        setLineIndex((i) => i + 1);
                        playSuggestedMove(lineIndex + 1);
                      }}
                      aria-label="Next suggested move"
                    >
                      <ChevronRight />
                    </button>
                    <span>
                      {lineIndex}/{linePositions.length - 1}
                    </span>
                  </div>
                </div>
              )}
              <div className="am-review-key-filter">
                <label>
                  Key moves for{" "}
                  <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="both">Both players</option>
                    <option value="w">White</option>
                    <option value="b">Black</option>
                  </select>
                </label>
                <button
                  onClick={() => {
                    clearPosition();
                    setScreen("highlights");
                  }}
                >
                  Game graph
                </button>
              </div>
              <div className="am-review-bottom">
                <button onClick={showLine} disabled={!current?.bestmove}>
                  <Eye />
                  {lineIndex >= 0 ? "Hide" : "Show"}
                </button>
                <button onClick={best} disabled={!current?.bestmove}>
                  <Lightbulb />
                  Best
                </button>
                <button onClick={beginRetry} disabled={!current?.bestmove}>
                  <RotateCw />
                  Retry
                </button>
                <button
                  className="am-review-next"
                  onClick={nextKey}
                  disabled={!report.moves.length}
                >
                  Next <ChevronRight />
                </button>
              </div>
            </>
          )}
          <footer className="am-review-footer">
            <span>{savedMessage}</span>
            <div>
              <button onClick={() => start(report.pgn, true)}>
                Review again
              </button>
              <button
                onClick={() => {
                  active.current?.abort();
                  generation.current++;
                  setReport(null);
                  setParsed(null);
                  setStatus("idle");
                  clearPosition();
                  rememberPgn("");
                }}
              >
                New PGN
              </button>
            </div>
            <small>
              Local Stockfish estimates. Scores and explanations can change with
              analysis depth.
            </small>
          </footer>
        </>
      )}
      {settingsOpen && (
        <div
          className="am-review-shade"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSettingsOpen(false);
          }}
        >
          <section
            ref={settingsDialog}
            className="am-review-settings"
            role="dialog"
            aria-modal="true"
            aria-label="Review settings"
            onKeyDown={(e) => {
              if (e.key === "Escape") setSettingsOpen(false);
              if (e.key === "Tab") {
                const all = [
                  ...e.currentTarget.querySelectorAll("button,input,select"),
                ].filter((el) => !el.disabled);
                const first = all[0],
                  last = all.at(-1);
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last?.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first?.focus();
                }
              }
            }}
          >
            <header>
              <h2>Review settings</h2>
              <button
                aria-label="Close review settings"
                onClick={() => setSettingsOpen(false)}
              >
                <X />
              </button>
            </header>
            {[
              ["showCoach", "Show Coach Avatar"],
              ["showEval", "Show Evaluation Bar"],
              ["showArrows", "Show Best Move Arrows"],
              ["autoplay", "Autoplay Show Moves"],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  type="checkbox"
                  checked={settings[key]}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, [key]: e.target.checked }))
                  }
                />
              </label>
            ))}
            <label>
              Delay Between Moves
              <select
                value={settings.delay}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, delay: Number(e.target.value) }))
                }
              >
                <option value="500">0.5 seconds</option>
                <option value="900">0.9 seconds</option>
                <option value="1500">1.5 seconds</option>
              </select>
            </label>
            <p>
              Analysis uses Stockfish. Exact Chess.com scoring
              and coach voices are unavailable.
            </p>
            <button
              className="am-review-primary"
              onClick={() => setSettingsOpen(false)}
            >
              Done
            </button>
          </section>
        </div>
      )}
    </section>
  );
}
export const NativeMobileReview = MobileReview;
