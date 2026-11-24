import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Chess } from "chess.js";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Flag,
  Lightbulb,
  List,
  RotateCcw,
  Settings,
  X,
  Pause,
  Play,
  Plus,
  Star,
} from "lucide-react";
import { Board } from "../Board";
import { localAvatar, localBotAvatar, localCoach, localLogo, localPiece } from "./local-art";
import { botDialogue } from "../bot-dialogue";
import { moveRows } from "../gameplay";
import {
  openMobileSettings,
  saveMobileFile,
  copyMobileText,
} from "../mobile-api";
import "./game-view.css";
import { MobileAnalysisVariations } from "./variations";
import { NativeLocalResult } from "./local-result";
import { BotResult } from "./bot-result";
import {createRulesGame} from "../chess-rules";

const material = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const figurines = { K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘" };
const notation = (san, enabled = true) =>
  enabled ? String(san).replace(/[KQRBN]/g, (p) => figurines[p]) : san;
function clock(seconds) {
  const value = Math.max(0, Math.ceil(seconds || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}
function evalText(engine) {
  if (!engine) return "—";
  if (engine.mate != null)
    return engine.mate === 0
      ? "Mate"
      : `${engine.mate > 0 ? "+" : "−"}M${Math.abs(engine.mate)}`;
  return Number.isFinite(engine.evaluation)
    ? `${engine.evaluation >= 0 ? "+" : ""}${engine.evaluation.toFixed(2)}`
    : "—";
}
function lineText(fen, line, variant) {
  const board = createRulesGame(fen, variant),
    text = [];
  for (const uci of line?.pv?.slice(0, 12) || []) {
    try {
      const turn = board.turn(),
        number = board.moveNumber();
      const move = board.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci[4],
      });
      text.push(
        `${turn === "w" ? number + ". " : !text.length ? number + "... " : ""}${notation(move.san)}`,
      );
    } catch {
      break;
    }
  }
  return text.join(" ");
}
function Captures({ moves, color }) {
  const pieces = moves
    .filter((m) => m.color === color && m.captured)
    .map((m) => m.captured)
    .sort((a, b) => material[a] - material[b]);
  return (
    <span
      className="am-captures"
      aria-label={`${color === "w" ? "White" : "Black"} captured ${pieces.length} pieces`}
    >
      {pieces.map((piece, index) => (
        <img
          key={index}
          src={localPiece(`${color === "w" ? "b" : "w"}${piece}`)}
          alt=""
        />
      ))}
    </span>
  );
}
function Modal({ title, children, close, sheet = false, hideHeader = false, variant = "" }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
    const key = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
      if (e.key === "Tab") {
        const controls = [
          ...ref.current.querySelectorAll("button,input,a[href]"),
        ].filter((n) => !n.disabled);
        const first = controls[0],
          last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus({ preventScroll: true });
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus({ preventScroll: true });
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div
      className={`am-game-modal-cover ${sheet ? "am-game-sheet-cover" : ""} ${variant && variant + "-cover"}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        className={`am-game-modal ${sheet ? "am-game-sheet" : ""} ${variant}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        {!hideHeader && (
          <header>
            <h2>{title}</h2>
            <button onClick={close} aria-label="Close">
              <X />
            </button>
          </header>
        )}
        {children}
      </section>
    </div>
  );
}

/** Android bot and Play in Person arrangements measured from installed 4.10.23.
 * Exact analysis-only player rows remain to be captured.
 */
export function MobileGameView({
  controller: c,
  prefs = {},
  onBack,
  onSettings,
  onReview,
  onAnalyze,
  onBoardRotatesChange,
  onNewGame,
}) {
  const [modal, setModal] = useState(""),
    [notice, setNotice] = useState(""),
    [resultOpen, setResultOpen] = useState(false);
  useEffect(() => {
    setResultOpen(!!c.result && ["local", "bot"].includes(c.mode));
  }, [c.result, c.mode]);
  useEffect(() => {
    const back = (e) => {
      if (e.defaultPrevented) return;
      if (modal) {
        e.preventDefault();
        setModal("");
      } else if (resultOpen) {
        e.preventDefault();
        setResultOpen(false);
      }
    };
    window.addEventListener("chess-native-back", back);
    return () => window.removeEventListener("chess-native-back", back);
  }, [modal, resultOpen]);
  const notationRef = useRef(null),
    noticeTimer = useRef(null);
  const display = c.display || c.game;
  const moves = c.moves || [];
  const view = c.view ?? moves.length;
  const isBot = c.mode === "bot",
    humanColor = c.side || "w";
  const bot = c.bot;
  const topColor = c.flipped ? "w" : "b",
    bottomColor = c.flipped ? "b" : "w";
  const shownMoves = moves.slice(0, view);
  const captured = useMemo(
    () =>
      Object.fromEntries(
        ["w", "b"].map((color) => [
          color,
          shownMoves
            .filter((m) => m.color === color && m.captured)
            .reduce((sum, m) => sum + material[m.captured], 0),
        ]),
      ),
    [moves, view],
  );
  const line = useMemo(
    () => lineText(display.fen(), c.engine?.lines?.[0], c.variant),
    [display.fen(), c.engine, c.variant],
  );
  const analysisArrows = useMemo(() => {
    if (c.mode !== "analysis") return [];
    const suggestions =
      prefs.suggestionArrows && c.engine?.bestmove
        ? [[c.engine.bestmove.slice(0, 2), c.engine.bestmove.slice(2, 4)]]
        : [];
    if (!prefs.threatArrows) return suggestions;
    // Local attack overlay; this is not Chess.com's proprietary threat search.
    const enemy = display.turn() === "w" ? "b" : "w";
    const targets = display
      .board()
      .flat()
      .filter((p) => p?.color === display.turn())
      .sort((a, b) => material[b.type] - material[a.type]);
    const threats = targets
      .flatMap((p) =>
        display.attackers(p.square, enemy).map((from) => [from, p.square]),
      )
      .slice(0, 4);
    return [...suggestions, ...threats];
  }, [
    display.fen(),
    c.mode,
    c.engine,
    prefs.suggestionArrows,
    prefs.threatArrows,
  ]);
  const value =
    c.engine?.mate != null
      ? Math.sign(c.engine.mate) * 12
      : c.engine?.evaluation || 0;
  const percentage = 50 + Math.max(-45, Math.min(45, value * 7.5));
  const headers = c.game.getHeaders();
  const botSpeech =
    bot?.coach ? c.coachFeedback || "Look for checks, captures, and threats."
      : isBot && bot && prefs.botChat !== false
      ? botDialogue(bot, c.game, humanColor, c.result || "")
      : "";
  const tell = (text) => {
    clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = setTimeout(() => setNotice(""), 2500);
  };
  useEffect(() => () => clearTimeout(noticeTimer.current), []);
  useLayoutEffect(() => {
    const panel = notationRef.current,
      selected = panel?.querySelector('[aria-current="true"]');
    if (!panel || !selected) return;
    const p = panel.getBoundingClientRect(),
      r = selected.getBoundingClientRect();
    if (r.left < p.left) panel.scrollLeft -= p.left - r.left;
    else if (r.right > p.right) panel.scrollLeft += r.right - p.right;
  }, [view, moves.length]);
  function exportPgn() {
    const pgn = c.pgn || c.game.pgn();
    if (saveMobileFile("chess-local-game.pgn", pgn)) return;
    const url = URL.createObjectURL(
      new Blob([pgn], { type: "application/x-chess-pgn" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "chess-local-game.pgn";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function review() {
    setModal("");
    onReview?.(c.pgn || c.game.pgn());
  }
  function analyze() {
    setModal("");
    onAnalyze?.(display.fen(), c.pgn || c.game.pgn(), view);
  }
  function playerName(color) {
    return (
      headers[color === "w" ? "White" : "Black"] ||
      (isBot && color !== humanColor
        ? bot?.name
        : color === "w"
          ? "White"
          : "Black")
    );
  }
  const lowerClock = c.timeControl > 0 ? clock(c.clocks?.[bottomColor]) : null;
  const upperClock = c.timeControl > 0 ? clock(c.clocks?.[topColor]) : null;
  const reviewingHistory = !c.result && view < moves.length;
  function returnToGame() {
    clearTimeout(noticeTimer.current);
    setNotice("");
    c.goView(moves.length);
  }
  const resultDialog = resultOpen && c.result && c.mode === "local" ? <NativeLocalResult
    controller={c} prefs={prefs} onClose={()=>setResultOpen(false)}
    onReview={onReview} onAnalyze={onAnalyze} onNewGame={onNewGame}
  /> :
    resultOpen && c.result && isBot ? (
      <Modal title="Game over" close={() => setResultOpen(false)} hideHeader variant="am-bot-result">
        <BotResult
          game={c}
          quickAnalysis={prefs.quickAnalysis !== false}
          onClose={() => setResultOpen(false)}
          onShare={exportPgn}
          onReview={review}
          onNewGame={onNewGame}
        />
      </Modal>
    ) : null;

  if (c.mode === "local")
    return (
      <section
        className="am-game am-local-game"
        aria-label="Play in Person game"
      >
        <header className="am-local-header">
          <button onClick={onBack} aria-label="Back from game">
            <ArrowLeft />
          </button>
          <h1>
            <img src={localLogo} alt="" />
            Play in Person
          </h1>
          <span />
        </header>
        <div
          className="am-local-notation"
          ref={notationRef}
          aria-label="Game moves"
        >
          {moveRows(moves).map((row) => (
            <React.Fragment key={row.number}>
              <span>
                {row.number}
                {row.white ? "." : "..."}
              </span>
              {["white", "black"].map(
                (color) =>
                  row[color] && (
                    <button
                      key={color}
                      className={view === row[color].index + 1 ? "current" : ""}
                      aria-current={
                        view === row[color].index + 1 ? "true" : undefined
                      }
                      onClick={() => c.goView(row[color].index + 1)}
                    >
                      {notation(
                        row[color].move.san,
                        prefs.notation !== "standard",
                      )}
                    </button>
                  ),
              )}
            </React.Fragment>
          ))}
        </div>
        <div className="am-local-player">
          <div className="am-local-avatar">
            <img src={localAvatar} alt="" />
          </div>
          <div>
            <strong>{playerName(topColor)}</strong>
            <Captures moves={shownMoves} color={topColor} />
          </div>
          {upperClock && <span className="am-game-clock">{upperClock}</span>}
          {reviewingHistory && (
            <div className="am-local-history-return">
              <small role="status">Viewing history</small>
              <button onClick={returnToGame}>Return to Game</button>
            </div>
          )}
        </div>
        <div className="am-game-board" onPointerDown={reviewingHistory
          ? () => tell("Tap Return to Game to continue from the latest move.")
          : undefined}>
          <Board
            game={display}
            prefs={prefs}
            legacySpringMode={c.timeControl || c.increment ? "FAST" : "SIMPLE"}
            flipped={!!c.flipped}
            onMove={c.applyMove}
            lastMove={c.lastMove}
            disabled={!c.canMove || !!modal}
            onIllegal={() => tell("That move is not legal.")}
          />
          {c.paused && (
            <div className="am-game-pause-layer">
              <Pause />
              <b>Game paused</b>
              <button onClick={c.resume}>Resume</button>
            </div>
          )}
        </div>
        <div className="am-local-player">
          <div className="am-local-avatar">
            <img src={localAvatar} alt="" />
          </div>
          <div>
            <strong>{playerName(bottomColor)}</strong>
            <Captures moves={shownMoves} color={bottomColor} />
            {c.result && (
              <span className="am-local-result" role="status">
                {c.result}
              </span>
            )}
          </div>
          {lowerClock && <span className="am-game-clock">{lowerClock}</span>}
        </div>
        <nav className="am-local-controls" aria-label="Game controls">
          <button onClick={() => setModal("options")}>
            <List />
            <span>Options</span>
          </button>
          <button onClick={() => c.goView(view - 1)} disabled={!view}>
            <ChevronLeft />
            <span>Back</span>
          </button>
          <button
            onClick={() => c.goView(view + 1)}
            disabled={view >= moves.length}
          >
            <ChevronRight />
            <span>Forward</span>
          </button>
        </nav>
        {c.result && (
          <div className="am-game-result-actions">
            <button onClick={review}>Game Review</button>
            <button onClick={analyze}>Analysis</button>
          </div>
        )}
        {resultDialog}
        {notice && (
          <div className="am-game-notice" role="status">
            {notice}
          </div>
        )}
        {modal === "options" && (
          <Modal title="Options" hideHeader close={() => setModal("")}>
            <div className="am-game-options">
              <button onClick={() => setModal("resign")} disabled={!!c.result}>
                Resign
              </button>
              <button
                onClick={() => {
                  onBoardRotatesChange?.(!prefs.boardRotates);
                  setModal("");
                }}
              >
                {prefs.boardRotates ? "Disable" : "Enable"} Board Rotates
              </button>
              <button
                onClick={async () => {
                  const copied = await copyMobileText(c.pgn || c.game.pgn());
                  setModal("");
                  tell(copied ? "PGN copied" : "Could not copy PGN.");
                }}
              >
                Copy PGN
              </button>
            </div>
          </Modal>
        )}
        {(modal === "resign" || modal === "draw") && (
          <Modal
            title={modal === "resign" ? "Resign Game?" : "Agree to a draw?"}
            close={() => setModal("")}
          >
            <p className="am-game-confirm-text">
              {modal === "resign"
                ? "The player whose turn it is will resign."
                : "Both players must agree to end the game as a draw."}
            </p>
            <div className="am-game-confirm-actions">
              <button onClick={() => setModal("")}>Cancel</button>
              <button
                onClick={() => {
                  modal === "resign" ? c.resign() : c.agreeDraw();
                  setModal("");
                }}
              >
                {modal === "resign" ? "Resign" : "Agree Draw"}
              </button>
            </div>
          </Modal>
        )}
      </section>
    );

  return (
    <section
      className="am-game"
      aria-label={
        isBot
          ? "Bot game"
          : c.mode === "analysis"
            ? "Analysis board"
            : "Local chess game"
      }
    >
      <header className="am-game-header">
        <button onClick={onBack} aria-label="Back from game">
          <ArrowLeft />
        </button>
        <strong className="am-game-brand">Chess Local</strong>
        <button onClick={onSettings} aria-label="Game settings">
          <Settings />
        </button>
      </header>
      {(prefs.eval !== false || prefs.engineLines !== false) && (
        <section className="am-game-engine" aria-label="Engine evaluation">
          {prefs.engineLines !== false && (
            <div className="am-game-pv" title={line}>
              {line || (c.hintBusy ? "Finding a move…" : "")}
            </div>
          )}
          {prefs.eval !== false && (
            <div className="am-game-eval">
              <span style={{ width: `${percentage}%` }} />
              <b>{evalText(c.engine)}</b>
            </div>
          )}
        </section>
      )}
      <div
        className={`am-game-opponent ${isBot ? "" : "am-game-opponent-local"}`}
      >
        {isBot && bot ? (
          <>
            <div className="am-game-bot-avatar">
              <img src={bot.coach ? localCoach : localBotAvatar(bot)} alt={bot.name} />
            </div>
            {botSpeech && (
              <div className="am-game-speech" aria-live="polite">
                {botSpeech}
              </div>
            )}
            {upperClock && (
              <span className="am-game-clock am-game-upper-clock">
                {upperClock}
              </span>
            )}
          </>
        ) : (
          <>
            <span className="am-game-player-avatar">
              {topColor === "w" ? "♙" : "♟"}
            </span>
            <strong>{playerName(topColor)}</strong>
            {upperClock && <span className="am-game-clock">{upperClock}</span>}
          </>
        )}
      </div>
      <div className="am-game-board">
        <Board
          game={display}
          prefs={prefs}
          legacySpringMode={!isBot ? "SIMPLE" : undefined}
          flipped={!!c.flipped}
          onMove={c.applyMove}
          lastMove={c.lastMove}
          hint={c.hint}
          tutorialArrows={analysisArrows}
          disabled={!c.canMove || !!modal}
          onIllegal={() => tell("That move is not legal.")}
        />
        {c.paused && (
          <div className="am-game-pause-layer">
            <Pause />
            <b>Game paused</b>
            <button onClick={c.resume}>Resume</button>
          </div>
        )}
      </div>
      <div className="am-game-material">
        <Captures moves={shownMoves} color={bottomColor} />
        {captured[bottomColor] > captured[topColor] && (
          <span>+{captured[bottomColor] - captured[topColor]}</span>
        )}
        <span className="am-game-material-spacer" />
        {lowerClock && <span className="am-game-clock">{lowerClock}</span>}
        <span className="am-game-self" title={playerName(bottomColor)}>
          {bottomColor === "w" ? "♙" : "♟"}
        </span>
      </div>
      {c.error ? (
        <div className="am-game-connection" role="alert">
          <p>{c.error}</p>
          <div>
            <button onClick={c.retryEngine}>Retry</button>
            <button onClick={openMobileSettings}>Connect to PC</button>
            {isBot && reviewingHistory && (
              <button onClick={returnToGame}>Return to Game</button>
            )}
          </div>
        </div>
      ) : (
        <div className="am-game-state" role="status">
          {c.result ||
            (c.busy
              ? "Thinking…"
              : c.hintBusy
                ? "Finding a hint…"
                : view < moves.length
                  ? "Viewing game history"
                  : "")}
          {isBot && reviewingHistory && (
            <button className="am-history-return" onClick={returnToGame}>Return to Game</button>
          )}
        </div>
      )}
      {c.result && !isBot && (
        <div className="am-game-result-actions">
          <button onClick={review}>Game Review</button>
          <button onClick={analyze}>Analysis</button>
        </div>
      )}
      <nav className="am-game-notation" aria-label="Game moves">
        <button
          onClick={() => c.goView(view - 1)}
          disabled={!view}
          aria-label="Previous move"
        >
          <ChevronLeft />
        </button>
        <div className="am-game-move-strip" ref={notationRef}>
          {!moves.length && (
            <span className="am-game-empty-moves">Make your first move</span>
          )}
          {moves.map((m, i) => (
            <React.Fragment key={`${i}-${m.san}`}>
              {(m.color === "w" || i === 0) && (
                <span className="am-game-move-number">
                  {Number(m.before.split(" ")[5])}
                  {m.color === "b" ? "..." : "."}
                </span>
              )}
              <button
                onClick={() => c.goView(i + 1)}
                aria-label={`Move ${i + 1}: ${m.san}`}
                aria-current={view === i + 1 ? "true" : undefined}
              >
                {notation(m.san, prefs.notation !== "standard")}
              </button>
            </React.Fragment>
          ))}
        </div>
        <button
          onClick={() => c.goView(view + 1)}
          disabled={view >= moves.length}
          aria-label="Next move"
        >
          <ChevronRight />
        </button>
      </nav>
      <nav className="am-game-actions" aria-label="Game actions">
        <button onClick={() => setModal("options")}>
          <List />
          <span>Options</span>
        </button>
        {isBot && c.result ? (
          <>
            <button onClick={() => onNewGame?.({ rematch: false })}><Plus /><span>New</span></button>
            <button onClick={review} disabled={!moves.length}><Star /><span>Review</span></button>
            <button onClick={() => c.goView(view - 1)} disabled={!view}><ChevronLeft /><span>Back</span></button>
            <button onClick={() => c.goView(view + 1)} disabled={view >= moves.length}><ChevronRight /><span>Forward</span></button>
          </>
        ) : (
        <>
        {c.mode === "analysis" ? <MobileAnalysisVariations controller={c} /> : c.mode === "archive" ? (
          <button onClick={review} disabled={!moves.length}>
            <Flag />
            <span>Review</span>
          </button>
        ) : (
          <button
            disabled={!!c.result || !c.started}
            onClick={() => setModal("resign")}
          >
            <Flag />
            <span>Resign</span>
          </button>
        )}
        <button
          onClick={c.getHint}
          disabled={c.busy || c.hintBusy || !!c.result || !!c.paused}
        >
          <Lightbulb />
          <span>Hint</span>
        </button>
        <button
          onClick={c.undo}
          disabled={!moves.length || !!c.result || c.mode === "archive"}
        >
          <RotateCcw />
          <span>Undo</span>
        </button>
        </>
        )}
      </nav>
      {notice && (
        <div className="am-game-notice" role="status">
          {notice}
        </div>
      )}
      {resultDialog}
      {modal === "options" && (
        <Modal title="Options" close={() => setModal("")}>
          <div className="am-game-options">
            <button
              onClick={() => {
                c.setFlipped();
                setModal("");
              }}
            >
              Flip Board
            </button>
            <button onClick={analyze}>Explorer</button>
            <button
              onClick={() => {
                exportPgn();
                setModal("");
              }}
            >
              Share Game
            </button>
            <button
              onClick={() => {
                exportPgn();
                setModal("");
              }}
            >
              Save Game
            </button>
            {!!moves.length && <button onClick={review}>Game Review</button>}
            {!c.result && c.started && (
              <button
                onClick={() => {
                  c.paused ? c.resume() : c.pause();
                  setModal("");
                }}
              >
                {c.paused ? "Resume Game" : "Pause Game"}
              </button>
            )}
            {!isBot && !c.result && c.started && (
              <button onClick={() => setModal("draw")}>Offer Draw</button>
            )}
          </div>
        </Modal>
      )}
      {modal === "resign" && isBot ? (
        <Modal title="Are you sure you want to resign?" close={() => setModal("")} hideHeader variant="am-bot-resign">
          <p>Are you sure you want to resign?</p>
          <div className="am-game-confirm-actions">
            <button onClick={() => setModal("")}>Cancel</button>
            <button onClick={() => { c.resign(); setModal(""); }}>Resign</button>
          </div>
        </Modal>
      ) : (modal === "resign" || modal === "draw") && (
        <Modal
          title={modal === "resign" ? "Resign Game?" : "Agree to a draw?"}
          close={() => setModal("")}
        >
          <p className="am-game-confirm-text">
            {modal === "resign"
              ? "This will end the game. You can review it afterward."
              : "Both players must agree to end the game as a draw."}
          </p>
          <div className="am-game-confirm-actions">
            <button onClick={() => setModal("")}>Cancel</button>
            <button
              onClick={() => {
                modal === "resign" ? c.resign() : c.agreeDraw();
                setModal("");
              }}
            >
              {modal === "resign" ? "Resign" : "Agree Draw"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
