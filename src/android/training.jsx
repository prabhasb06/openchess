import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Chess } from "chess.js";
import {
  Check,
  ChevronRight,
  Flame,
  Lightbulb,
  List,
  RotateCw,
  Settings,
  X,
  Clock,
  Star,
} from "lucide-react";
import { Board } from "../Board";
import { puzzles } from "../data";
import { sound, selectMoveSound } from "../audio";
import {
  readTeachingPgn,
  teachingScreens,
  teachingGame,
  resetTeachingTurn,
} from "../teaching";
import { MobileColorIcon, MobileHeader } from "./chrome";
import { localCoach, localPiece } from "./local-art";
import { localLessons } from "./local-lessons";
import { MobileLearnMenu } from "./learn-menu";
import "./training.css";
const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(`chess-local-${key}`)) ?? fallback;
  } catch {
    return fallback;
  }
};
const save = (key, value) => {
  try {
    localStorage.setItem(`chess-local-${key}`, JSON.stringify(value));
  } catch {}
};
const uci = (move) => move.from + move.to + (move.promotion || "");
function moveUci(game, text) {
  return game.move({
    from: text.slice(0, 2),
    to: text.slice(2, 4),
    promotion: text[4],
  });
}
function TrainingCoach({ children }) {
  return (
    <div className="am-training-coach">
      <img src={localCoach} alt="Coach" />
      <div>{children}</div>
    </div>
  );
}
function TrainingSheet({ title, onClose, children }) {
  const panel = useRef(null);
  useEffect(() => {
    const prior = document.activeElement;
    panel.current?.focus({ preventScroll: true });
    const key = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const controls = [
          ...(panel.current?.querySelectorAll(
            "button,input,select,textarea,a[href]",
          ) || []),
        ].filter((el) => !el.disabled && el.getClientRects().length);
        const first = controls[0],
          last = controls.at(-1);
        if (!first) {
          e.preventDefault();
          return;
        }
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === panel.current)
        ) {
          e.preventDefault();
          last.focus({ preventScroll: true });
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus({ preventScroll: true });
        }
      }
    };
    const nativeBack = (e) => {
      e.preventDefault();
      onClose();
    };
    window.addEventListener("chess-native-back", nativeBack);
    document.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("chess-native-back", nativeBack);
      document.removeEventListener("keydown", key);
      if (prior?.isConnected) prior.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div
      className="am-training-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="am-training-sheet"
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button onClick={onClose} aria-label={`Close ${title}`}>
            <X />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function MobilePuzzles({
  prefs,
  onBack,
  onNavigate,
  onSolved,
  onExerciseChange,
  initialMode = "standard",
}) {
  const [solved, setSolved] = useState(() => read("solved", [])),
    [pointAwards, setPointAwards] = useState(() =>
      read("android-puzzle-point-awards", []),
    );
  const [mode, setMode] = useState(initialMode),
    [playing, setPlaying] = useState(false),
    [menu, setMenu] = useState(false),
    [custom, setCustom] = useState(false),
    [theme, setTheme] = useState("All");
  const [index, setIndex] = useState(0),
    [game, setGame] = useState(() => new Chess(puzzles[0].fen)),
    [step, setStep] = useState(0),
    [lastMove, setLastMove] = useState(null),
    [feedback, setFeedback] = useState(""),
    [done, setDone] = useState(false),
    [hint, setHint] = useState(false),
    [revealed, setRevealed] = useState(false),
    [busy, setBusy] = useState(false);
  const [rushScore, setRushScore] = useState(0),
    [rushMistakes, setRushMistakes] = useState(0),
    [rushLeft, setRushLeft] = useState(180),
    [rushEnded, setRushEnded] = useState(false),
    [rushBest, setRushBest] = useState(() => read("android-rush-best", 0));
  const timers = useRef(new Set()),
    generation = useRef(0),
    locked = useRef(false),
    deadline = useRef(0),
    rushUnique = useRef(new Set()),
    gameRef = useRef(game),
    currentMode = useRef(mode);
  gameRef.current = game;
  currentMode.current = mode;
  const item = puzzles[index],
    themes = useMemo(
      () => ["All", ...new Set(puzzles.map((p) => p.theme))],
      [],
    );
  const minimumDifficulty =
    prefs.puzzleDifficulty === "extra-hard"
      ? 850
      : prefs.puzzleDifficulty === "hard"
        ? 700
        : 0;
  const filtered = puzzles.flatMap((p, i) =>
    p.rating >= minimumDifficulty && (theme === "All" || p.theme === theme)
      ? [i]
      : [],
  );
  const cancel = () => {
    generation.current++;
    for (const timer of timers.current) clearTimeout(timer);
    timers.current.clear();
    locked.current = false;
    setBusy(false);
  };
  function later(action, delay = 400) {
    const token = generation.current,
      timer = setTimeout(() => {
        timers.current.delete(timer);
        if (token === generation.current) action();
      }, delay);
    timers.current.add(timer);
  }
  useEffect(
    () => () => {
      generation.current++;
      for (const timer of timers.current) clearTimeout(timer);
      onExerciseChange?.(false);
    },
    [],
  );
  useEffect(() => {
    onExerciseChange?.(playing, playing ? leave : null);
  }, [playing]);
  function loadPuzzle(next) {
    cancel();
    setIndex(next);
    const g = new Chess(puzzles[next].fen);
    setGame(g);
    gameRef.current = g;
    setStep(0);
    setLastMove(null);
    setFeedback("");
    setDone(false);
    setHint(false);
    setRevealed(false);
  }
  function begin(nextMode = "standard", nextIndex) {
    if (!["daily", "rush"].includes(nextMode) && !filtered.length) {
      setMenu(false);
      setCustom(true);
      return;
    }
    const next =
      nextIndex ??
      (nextMode === "daily"
        ? Math.floor(Date.now() / 86400000) % puzzles.length
        : (filtered.find((i) => !solved.includes(puzzles[i].id)) ??
          filtered[0] ??
          0));
    setMode(nextMode);
    currentMode.current = nextMode;
    loadPuzzle(next);
    setPlaying(true);
    setMenu(false);
    setCustom(false);
    if (nextMode === "rush") {
      setRushScore(0);
      setRushMistakes(0);
      setRushLeft(180);
      setRushEnded(false);
      deadline.current = Date.now() + 180000;
      rushUnique.current = new Set();
    }
    sound.unlock();
  }
  useEffect(() => {
    if (["daily", "rush", "custom"].includes(initialMode)) begin(initialMode);
  }, []);
  function endRush() {
    cancel();
    setRushEnded(true);
    setDone(true);
    deadline.current = 0;
    setRushBest((old) => {
      const best = Math.max(old, rushUnique.current.size);
      save("android-rush-best", best);
      return best;
    });
  }
  useEffect(() => {
    if (!playing || mode !== "rush" || rushEnded) return;
    const tick = () => {
      const seconds = Math.max(
        0,
        Math.ceil((deadline.current - Date.now()) / 1000),
      );
      setRushLeft(seconds);
      if (!seconds) endRush();
    };
    tick();
    const interval = setInterval(tick, 200);
    return () => clearInterval(interval);
  }, [playing, mode, rushEnded]);
  function leave() {
    cancel();
    deadline.current = 0;
    setPlaying(false);
    setRushEnded(false);
    onExerciseChange?.(false);
  }
  function solvedPuzzle(g) {
    locked.current = true;
    setGame(g);
    setDone(true);
    setFeedback(item.explanation);
    sound.play("puzzle-correct");
    // One local point per distinct puzzle while collection is enabled. Keep
    // this separate from completion and from Rush's per-run score.
    if (
      !revealed &&
      mode !== "rush" &&
      prefs.puzzlePoints !== false &&
      !pointAwards.includes(item.id)
    ) {
      const awards = [...pointAwards, item.id];
      setPointAwards(awards);
      save("android-puzzle-point-awards", awards);
    }
    if (!revealed && !solved.includes(item.id)) {
      const next = [...solved, item.id];
      setSolved(next);
      save("solved", next);
      onSolved?.(item.id);
    }
    if (mode === "rush" && !revealed && !rushUnique.current.has(item.id)) {
      rushUnique.current.add(item.id);
      setRushScore(rushUnique.current.size);
      if (rushUnique.current.size >= puzzles.length) endRush();
      else later(() => loadPuzzle((index + 1) % puzzles.length), 550);
    }
  }
  function onMove(from, to, promotion = "q") {
    if (locked.current || done || busy || rushEnded) return;
    const g = new Chess(gameRef.current.fen());
    let move;
    try {
      move = g.move({ from, to, promotion });
    } catch {
      sound.play("illegal");
      return;
    }
    if (uci(move) !== item.moves[step]) {
      setFeedback("Not quite. Look for a stronger move and try again.");
      sound.play("puzzle-wrong");
      if (mode === "rush") {
        const mistakes = rushMistakes + 1;
        setRushMistakes(mistakes);
        locked.current = true;
        if (mistakes >= 3) endRush();
        else later(() => loadPuzzle((index + 1) % puzzles.length), 550);
      }
      return;
    }
    locked.current = true;
    setHint(false);
    setFeedback("");
    setLastMove(move);
    setGame(g);
    gameRef.current = g;
    sound.play(selectMoveSound(move));
    let next = step + 1;
    if (next >= item.moves.length) {
      setStep(next);
      solvedPuzzle(g);
      return;
    }
    setBusy(true);
    later(() => {
      const reply = moveUci(g, item.moves[next]);
      next++;
      setStep(next);
      setLastMove(reply);
      setGame(new Chess(g.fen()));
      gameRef.current = g;
      setBusy(false);
      locked.current = false;
      sound.play(selectMoveSound(reply, false, true));
      if (next >= item.moves.length) solvedPuzzle(g);
    }, 400);
  }
  function reveal() {
    if (mode === "rush" || done || busy) return;
    cancel();
    const g = new Chess(game.fen());
    let last;
    for (const text of item.moves.slice(step)) last = moveUci(g, text);
    setRevealed(true);
    setGame(g);
    setLastMove(last);
    setStep(item.moves.length);
    setDone(true);
    locked.current = true;
    setFeedback(item.explanation);
  }
  const nextPuzzle = () => {
    const order = filtered.length ? filtered : puzzles.map((_, i) => i);
    const at = order.indexOf(index);
    loadPuzzle(order[(at + 1) % order.length]);
  };
  const remainingMove = item.moves[step];
  if (playing)
    return (
      <section
        className="am-training-exercise"
        data-training="puzzle"
        data-puzzle-id={item.id}
      >
        <MobileHeader
          title={
            mode === "rush"
              ? "Puzzle Rush"
              : mode === "daily"
                ? "Daily Puzzle"
                : "Puzzles"
          }
          icon={mode === "daily" ? "calendar-dailypuzzle" : "puzzle-piece"}
          onBack={leave}
          onSettings={() => setMenu(true)}
        />
        {mode === "rush" && (
          <div className="am-rush-score">
            <span>
              <Clock />
              {Math.floor(rushLeft / 60)}:
              {String(rushLeft % 60).padStart(2, "0")}
            </span>
            <strong>{rushScore}</strong>
            <span aria-label={`${rushMistakes} mistakes out of 3`}>
              {[0, 1, 2].map((n) => (
                <X key={n} className={n < rushMistakes ? "lost" : ""} />
              ))}
            </span>
          </div>
        )}
        <TrainingCoach>
          {rushEnded
            ? "Puzzle Rush complete! Review the patterns and try again."
            : done
              ? revealed
                ? "Here is the solution. Try another puzzle to practice."
                : "Correct! Well done."
              : `${new Chess(item.fen).turn() === "w" ? "White" : "Black"} to move. Find the best move.`}
        </TrainingCoach>
        <Board
          game={game}
          prefs={{ ...prefs, nativeMobile: true }}
          legacySpringMode={mode === "standard" || mode === "daily" ? "SLOW" : undefined}
          flipped={new Chess(item.fen).turn() === "b"}
          onMove={onMove}
          disabled={done || busy || rushEnded}
          lastMove={lastMove}
          hint={hint && remainingMove ? remainingMove : ""}
          onIllegal={() => sound.play("illegal")}
        />
        <div className="am-training-feedback" role="status">
          {(prefs.puzzleRating !== false || done) && (
            <span className="am-local-puzzle-difficulty">
              Local difficulty: {item.rating}
            </span>
          )}
          <h2>
            {rushEnded
              ? `Score: ${rushScore}`
              : done
                ? revealed
                  ? "Solution"
                  : "Correct!"
                : item.theme}
          </h2>
          <p>
            {feedback ||
              (busy
                ? "Your opponent replies…"
                : "Take your time. Look for checks, captures, and threats.")}
          </p>
          {rushEnded && (
            <p>
              Best: {rushBest} · {rushMistakes} mistakes
            </p>
          )}
        </div>
        <div className="am-training-exercise-actions">
          {rushEnded ? (
            <>
              <button className="am-primary" onClick={() => begin("rush", 0)}>
                Play Again
              </button>
              <button className="am-training-secondary" onClick={leave}>
                Back to Puzzles
              </button>
            </>
          ) : done && mode !== "rush" ? (
            <>
              <button className="am-primary" onClick={nextPuzzle}>
                Next Puzzle
              </button>
              <button
                className="am-training-secondary"
                onClick={() => loadPuzzle(index)}
              >
                Retry Puzzle
              </button>
            </>
          ) : mode !== "rush" ? (
            <>
              <button
                onClick={() => setHint((value) => !value)}
                aria-pressed={hint}
              >
                <Lightbulb />
                Hint
              </button>
              <button onClick={() => loadPuzzle(index)}>
                <RotateCw />
                Retry
              </button>
              <button onClick={reveal}>Show Solution</button>
            </>
          ) : null}
        </div>
        {menu && (
          <TrainingSheet title="Puzzle Options" onClose={() => setMenu(false)}>
            <button
              onClick={() => {
                setMenu(false);
                leave();
              }}
            >
              Back to Puzzle Path
            </button>
            <button
              onClick={() => {
                setMenu(false);
                onNavigate?.("settings");
              }}
            >
              Board & Sound Settings
            </button>
          </TrainingSheet>
        )}
      </section>
    );
  return (
    <section className="am-puzzle-landing" data-training="puzzle-path">
      <MobileHeader
        title="Puzzles"
        icon={<MobileColorIcon name="puzzle-tier-badge" />}
      />
      <div className="am-mobile-puzzle-path">
        <div className="am-native-terrain" />
        <TrainingCoach>
          Puzzles help you play your openings more safely, your middlegames more
          confidently, and your endgames more accurately.
        </TrainingCoach>
        <div className="am-puzzle-nodes" aria-label="Local puzzle path">
          {filtered.map((i, position) => {
            const p = puzzles[i];
            return (
              <button
                key={p.id}
                className={`am-puzzle-node ${solved.includes(p.id) ? "is-solved" : ""}`}
                style={{
                  "--node-x": `${[78, 64, 50, 36, 22, 36, 50, 64][position % 8]}%`,
                  "--node-y": `${position * 48}px`,
                }}
                onClick={() => begin("standard", i)}
                aria-label={`Puzzle ${i + 1}: ${p.title}${solved.includes(p.id) ? ", completed" : ""}`}
              >
                {solved.includes(p.id) ? <Check /> : i + 1}
              </button>
            );
          })}
        </div>
      </div>
      <div className="am-puzzle-path-progress">
        <strong>
          {pointAwards.length}
          <small>
            {prefs.puzzlePoints === false
              ? "Local points · collection off"
              : "Local points"}
          </small>
        </strong>
        <div>
          <i
            style={{
              width: `${Math.min(100, (pointAwards.length / puzzles.length) * 100)}%`,
            }}
          />
        </div>
      </div>
      <div className="am-training-dock">
        <button
          className="am-training-menu-button"
          onClick={() => setMenu(true)}
          aria-label="Puzzle modes"
        >
          <List />
        </button>
        <button className="am-primary" onClick={() => begin("standard")}>
          Solve Puzzles
        </button>
      </div>
      {menu && (
        <TrainingSheet title="Puzzles" onClose={() => setMenu(false)}>
          <button onClick={() => begin("standard")}>Puzzles</button>
          <button onClick={() => begin("daily")}>Daily Puzzle</button>
          <button onClick={() => begin("rush", 0)}>
            Puzzle Rush <span>3 minutes · 3 mistakes</span>
          </button>
          <button
            onClick={() => {
              setMenu(false);
              setCustom(true);
            }}
          >
            Custom Puzzles
          </button>
          <button
            onClick={() => {
              setMenu(false);
              onNavigate?.("Puzzle Battle");
            }}
          >
            Puzzle Battle
          </button>
        </TrainingSheet>
      )}
      {custom && (
        <TrainingSheet title="Custom Puzzles" onClose={() => setCustom(false)}>
          <label className="am-custom-label">
            Theme
            <select value={theme} onChange={(e) => setTheme(e.target.value)}>
              {themes.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <p>{filtered.length} local puzzles available</p>
          <p>
            {prefs.puzzleDifficulty === "extra-hard"
              ? "Extra Hard"
              : prefs.puzzleDifficulty === "hard"
                ? "Hard"
                : "Standard"}{" "}
            difficulty · local library
          </p>
          <button
            disabled={!filtered.length}
            className="am-primary"
            onClick={() => begin("custom", filtered[0] ?? 0)}
          >
            Start Practice
          </button>
        </TrainingSheet>
      )}
    </section>
  );
}

export function MobileLearn({
  prefs,
  onBack,
  onNavigate,
  onCompleted,
  onExerciseChange,
}) {
  const catalog = localLessons;
  const [selected, setSelected] = useState(null),
    [menu, setMenu] = useState(false),
    [library, setLibrary] = useState(false),
    [completed, setCompleted] = useState(() => read("progress", []));
  const pathScroll = useRef(null);
  const nextTile = useRef(null);
  const closeMenu = useCallback(() => setMenu(false), []);
  useEffect(() => {
    onExerciseChange?.(!!selected, selected ? () => setSelected(null) : null);
    return () => onExerciseChange?.(false);
  }, [selected]);
  const next = catalog.find((l) => !completed.includes(l.id)) || catalog[0];
  useLayoutEffect(() => {
    const scroll = pathScroll.current;
    const tile = nextTile.current;
    if (!scroll || !tile) return;
    const bottom = tile.getBoundingClientRect().bottom;
    const visibleBottom = scroll.getBoundingClientRect().bottom - 48;
    scroll.scrollTop += Math.max(0, bottom - visibleBottom);
  }, [next?.id, selected]);
  function finish(id) {
    if (completed.includes(id)) return;
    const value = [...completed, id];
    setCompleted(value);
    save("progress", value);
    onCompleted?.(id);
  }
  function choose(lesson) {
    setSelected(lesson);
    setMenu(false);
    setLibrary(false);
  }
  if (selected)
    return (
      <MobileLesson
        key={selected.id}
        data={selected}
        prefs={prefs}
        onBack={() => setSelected(null)}
        onCompleted={finish}
        onNext={() => {
          const index = catalog.findIndex((l) => l.id === selected.id);
          if (index + 1 < catalog.length) setSelected(catalog[index + 1]);
          else setSelected(null);
        }}
      />
    );
  return (
    <section
      className={`am-learn-landing${menu ? " options-open" : ""}`}
      data-training="learn-path"
    >
      <MobileHeader title="Learn" icon="lessons" />
      <div className="am-mobile-lesson-path">
        <TrainingCoach>
          {next
            ? `Learn ${next.name === "Castling" ? "to castle to safety" : next.name.toLowerCase()}.`
            : "Build your chess skills, one lesson at a time."}
        </TrainingCoach>
        <div
          className="am-learn-path-scroll"
          ref={pathScroll}
          inert={menu || library}
        >
          <div
            className="am-mobile-lesson-nodes"
            aria-label="Learn to Play lessons"
          >
            {catalog.map((lesson, i) => (
              <React.Fragment key={lesson.id}>
                <button
                  ref={lesson.id === next?.id ? nextTile : undefined}
                  className={`am-mobile-lesson-node ${completed.includes(lesson.id) ? "is-complete" : ""} ${lesson.id === next?.id ? "is-next" : ""}`}
                  style={{
                    "--node-x": `${[72, 50, 28, 50][i % 4]}%`,
                    "--node-y": `${i * 78}px`,
                  }}
                  onClick={() => choose(lesson)}
                  aria-label={`Lesson ${i + 1}: ${lesson.name}${completed.includes(lesson.id) ? ", completed" : ""}`}
                >
                  <span>
                    {completed.includes(lesson.id) ? (
                      <Check />
                    ) : (
                      <img
                        src={localPiece("w" + ["k", "q", "r", "b", "n", "p"][i % 6])}
                        alt=""
                      />
                    )}
                  </span>
                  {lesson.id === next?.id && <strong>Next</strong>}
                </button>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
      <h2 className="am-learn-path-label">Learn to Play</h2>
      <div className="am-training-dock">
        <button
          className="am-training-menu-button"
          onClick={() => setMenu(true)}
          aria-label="Learning options"
        >
          <List />
        </button>
        <button
          className="am-primary"
          disabled={!next}
          onClick={() => choose(next)}
        >
          Next Lesson
        </button>
      </div>
      {menu && (
        <MobileLearnMenu
          onClose={closeMenu}
          onNext={() => choose(next)}
          disabled={!next}
          onCoach={() => {
            setMenu(false);
            onNavigate?.("coach");
          }}
          onOpening={() => {
            setMenu(false);
            onNavigate?.("openings");
          }}
          onLibrary={() => {
            setMenu(false);
            setLibrary(true);
          }}
        />
      )}
      {library && (
        <TrainingSheet title="Lesson Library" onClose={() => setLibrary(false)}>
          <p>Learn to Play · 12 public foundation lessons</p>
          {catalog.map((l) => (
            <button key={l.id} onClick={() => choose(l)}>
              <span>{l.name}</span>
              {completed.includes(l.id) ? <Check /> : <ChevronRight />}
            </button>
          ))}
        </TrainingSheet>
      )}
    </section>
  );
}

function MobileLesson({ data, prefs, onBack, onNext, onCompleted }) {
  const [question, setQuestion] = useState(0),
    [screen, setScreen] = useState(0),
    [phase, setPhase] = useState("screen"),
    [game, setGame] = useState(() =>
      teachingGame(
        readTeachingPgn(teachingScreens(data, 0)[0] || data.questions[0]).fen,
      ),
    ),
    [targets, setTargets] = useState([]),
    [answer, setAnswer] = useState(0),
    [feedback, setFeedback] = useState(""),
    [hint, setHint] = useState(false),
    [correct, setCorrect] = useState(false);
  const locked = useRef(false);
  const screens = teachingScreens(data, question),
    step = readTeachingPgn(
      phase === "screen"
        ? screens[screen] || data.questions[question]
        : data.questions[question],
    );
  function beginChallenge(index) {
    const parsed = readTeachingPgn(data.questions[index]);
    setQuestion(index);
    setPhase("challenge");
    setGame(teachingGame(parsed.fen));
    setTargets(parsed.stars);
    setAnswer(0);
    setFeedback("");
    setHint(false);
    setCorrect(false);
    locked.current = false;
  }
  function beginQuestion(index) {
    const content = teachingScreens(data, index);
    if (!content.length) {
      beginChallenge(index);
      return;
    }
    setQuestion(index);
    setPhase("screen");
    setScreen(0);
    setGame(teachingGame(readTeachingPgn(content[0]).fen));
    setTargets([]);
    setAnswer(0);
    setFeedback("");
    setHint(false);
    setCorrect(false);
    locked.current = false;
  }
  useEffect(() => {
    if (!screens.length) beginChallenge(0);
  }, []);
  function next() {
    if (phase === "screen") {
      if (screen + 1 < screens.length) {
        setScreen(screen + 1);
        setGame(teachingGame(readTeachingPgn(screens[screen + 1]).fen));
      } else beginChallenge(question);
    } else if (question + 1 < data.questions.length)
      beginQuestion(question + 1);
    else {
      setPhase("done");
      onCompleted(data.id);
      sound.play("lesson-pass");
    }
  }
  function complete(g) {
    locked.current = true;
    setCorrect(true);
    setGame(g);
    setFeedback(
      step.tags.LESSON_CHALLENGE_COMPLETE_TEXT || step.success || "Correct!",
    );
    sound.play("correct");
  }
  function onMove(from, to, promotion = "q") {
    if (phase !== "challenge" || locked.current) return;
    const g = teachingGame(game.fen()),
      side = g.turn();
    let move;
    try {
      const piece = g.get(from);
      if (
        piece?.type === "p" &&
        targets.includes(to) &&
        !g.get(to) &&
        Math.abs(from.charCodeAt(0) - to.charCodeAt(0)) === 1 &&
        Number(to[1]) - Number(from[1]) === (side === "w" ? 1 : -1)
      )
        g.put({ type: "p", color: side === "w" ? "b" : "w" }, to);
      move = g.move({ from, to, promotion });
    } catch {
      sound.play("illegal");
      return;
    }
    if (step.stars.length) {
      if (move.san === step.tags.LESSON_DISALLOWED_MOVE_SAN) {
        setFeedback(
          step.tags.LESSON_DISALLOWED_MOVE_TEXT ||
            "Try a different move to capture the star.",
        );
        sound.play("incorrect");
        return;
      }
      resetTeachingTurn(g, side);
      const remaining = targets.filter((s) => s !== to);
      setTargets(remaining);
      setGame(g);
      setFeedback("");
      sound.play(selectMoveSound(move));
      if (!remaining.length) complete(g);
      return;
    }
    const expected = teachingGame(game.fen());
    let required;
    try {
      required = expected.move(step.moves[answer]);
    } catch {}
    if (!required || uci(move) !== uci(required)) {
      setFeedback(
        step.moveNotes[answer]?.wrong ||
          step.wrong ||
          "Try again. " + step.text,
      );
      sound.play("incorrect");
      return;
    }
    sound.play(selectMoveSound(move));
    let nextAnswer = answer + 1;
    while (nextAnswer < step.moves.length && g.turn() !== side) {
      g.move(step.moves[nextAnswer]);
      nextAnswer++;
    }
    setGame(g);
    setAnswer(nextAnswer);
    setFeedback("");
    if (nextAnswer >= step.moves.length) complete(g);
  }
  let arrows = [];
  if (phase === "screen" || (hint && step.stars.length)) arrows = step.arrows;
  else if (hint && step.moves[answer]) {
    try {
      const move = teachingGame(game.fen()).move(step.moves[answer]);
      arrows = [[move.from, move.to]];
    } catch {}
  }
  return (
    <section
      className="am-training-exercise am-mobile-lesson"
      data-training="lesson"
      data-lesson={data.path}
    >
      <MobileHeader title={data.name} icon="lessons" onBack={onBack} />
      <TrainingCoach>
        {phase === "done"
          ? data.outroText
          : feedback ||
            (hint
              ? step.moveNotes[answer]?.hint ||
                step.hint ||
                "Move your piece to capture the highlighted star."
              : step.text || data.introText)}
      </TrainingCoach>
      {phase === "done" ? (
        <div className="am-lesson-complete">
          <Check className="am-lesson-complete-check" />
          <h2>Lesson Complete!</h2>
          <p>{data.name}</p>
        </div>
      ) : (
        <Board
          game={game}
          prefs={{ ...prefs, nativeMobile: true }}
          legacySpringMode="SIMPLE"
          onMove={onMove}
          disabled={phase !== "challenge" || correct}
          markers={targets}
          tutorialArrows={arrows}
          onIllegal={() => sound.play("illegal")}
        />
      )}
      <div className="am-mobile-lesson-progress">
        {phase === "screen"
          ? "Learn the idea"
          : phase === "done"
            ? "Great work!"
            : `Challenge ${question + 1}/${data.questions.length}`}
        <div>
          {data.questions.map((_, i) => (
            <i
              key={i}
              className={
                i < question || (i === question && correct) || phase === "done"
                  ? "is-complete"
                  : ""
              }
            />
          ))}
        </div>
      </div>
      <div className="am-training-exercise-actions">
        {phase === "done" ? (
          <>
            <button className="am-primary" onClick={onNext}>
              Next Lesson
            </button>
            <button className="am-training-secondary" onClick={onBack}>
              Back to Learn
            </button>
          </>
        ) : phase === "screen" ? (
          <button className="am-primary" onClick={next}>
            {screen === 0 && question === 0 ? "Let’s Start!" : "Continue"}
          </button>
        ) : correct ? (
          <button className="am-primary" onClick={next}>
            Continue
          </button>
        ) : (
          <>
            <button
              onClick={() => {
                setFeedback("");
                setHint((value) => !value);
              }}
              aria-pressed={hint}
            >
              <Lightbulb />
              Hint
            </button>
            <button onClick={() => beginChallenge(question)}>
              <RotateCw />
              Retry Challenge
            </button>
          </>
        )}
      </div>
    </section>
  );
}
