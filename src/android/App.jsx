import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Chess } from "chess.js";
import { X, Download, Upload, CheckCircle2 } from "lucide-react";
import {
  MobileHome,
  MobilePlayMenu,
  MobileMore,
  MobileTabs,
  MobileHeader,
  MobileColorIcon,
} from "./chrome";
import {
  MobileBots,
  MobileLocalSetup,
  MobileTimePicker,
  MOBILE_TIME_CONTROLS,
  mobileBots as bots,
} from "./play";
import { MobileGameView } from "./game-view";
import { adjustableBot } from "./local-bots";
import { MobileSettings } from "./settings";
import { MobilePuzzles, MobileLearn } from "./training";
import { MobileReview } from "./review";
import { MobilePositionEditor } from "./position-editor";
import { MobileOnboarding } from "./onboarding";
import { useMobileGame } from "./useMobileGame";
import { configureMobileSound } from "./audio";
import { parseReviewPgn } from "../review-model";
import { openMobileSettings, apiFetch, saveMobileFile } from "../mobile-api";
import { jsx, jsxs } from "react/jsx-runtime";
import { coachSetup } from "./offline-opponents";
import "./app.css";

const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem("chess-local-" + key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem("chess-local-" + key, JSON.stringify(value));
  } catch {}
};
function currentBotProfile(snapshot) {
  if (snapshot.bot?.coach) return null;
  if (snapshot.bot?.id === adjustableBot.id) return snapshot.bot;
  return bots.find((bot) => bot.id === (snapshot.botId || snapshot.bot?.id));
}
const defaultPrefs = {
  name: "Guest",
  board: "green",
  pieceStyle: "neo",
  sound: true,
  volume: 0.8,
  legal: true,
  coordinates: true,
  lastMove: true,
  animation: true,
  animationSpeed: "medium",
  magnifyPieces: true,
  notation: "figurine",
  botChat: true,
  eval: true,
};
const tabRoutes = new Set(["home", "puzzles", "lessons", "watch", "more"]);
const supported = new Set([
  "home",
  "new-game",
  "bots",
  "local-setup",
  "game",
  "analysis",
  "review",
  "history",
  "stats",
  "settings",
  "appearance",
  "puzzles",
  "daily",
  "rush",
  "lessons",
  "watch",
  "more",
  "openings",
  "practice",
  "position",
]);

export function MobileApp() {
  const [route, setRoute] = useState(() =>
    supported.has(location.hash.slice(1)) ? location.hash.slice(1) : "home",
  );
  const [onboarding,setOnboarding] = useState(()=>{
    const status=read("mobile-onboarding-v1",null);
    if(status?.complete) return false;
    if(status?.inProgress) return true;
    try { return !["settings","games","progress","solved","mobile-sessions-v1","sessions","mobile-analysis-v1"].some(key=>localStorage.getItem("chess-local-"+key)!==null); }
    catch { return false; }
  });
  useEffect(()=>{write("mobile-onboarding-v1",{...read("mobile-onboarding-v1",{}),version:1,complete:!onboarding,inProgress:onboarding});},[onboarding]);
  const [prefs, setPrefs] = useState(() => ({
    ...defaultPrefs,
    ...read("settings", {}),
  }));
  const [selected, setSelected] = useState(() => {
    const savedId = read("mobile-bot", null);
    if (savedId === adjustableBot.id) {
      const skill = read("mobile-stockfish-skill", adjustableBot.skill);
      return { ...adjustableBot, skill: Number.isInteger(skill) && skill >= 0 && skill <= 20 ? skill : adjustableBot.skill };
    }
    return bots.find((bot) => bot.id === savedId) || bots[0];
  });
  const [saved, setSaved] = useState(() => read("games", [])),
    [solved, setSolved] = useState(() => read("solved", [])),
    [completed, setCompleted] = useState(() => read("progress", []));
  const [exercise, setExercise] = useState(false),
    [modal, setModal] = useState(null),
    [timeMenu, setTimeMenu] = useState(false),
    [time, setTime] = useState(600),
    [increment, setIncrement] = useState(0),
    [reviewPgn, setReviewPgn] = useState(() => read("review-pgn", "")),
    [importValue, setImportValue] = useState(""),
    [error, setError] = useState(""),
    [toast, setToast] = useState("");
  const [editorFen, setEditorFen] = useState(() =>
    read("mobile-editor-fen", new Chess().fen()),
  );
  const [editorVariant,setEditorVariant] = useState(()=>read("mobile-editor-variant","standard"));
  const c = useMobileGame({ active: !onboarding && (route === "game" || route === "analysis") });
  const [boardRotates, setBoardRotates] = useState(() =>
    read("mobile-board-rotates", false),
  );
  const exerciseBack = useRef(null);
  const importRead = useRef(0);
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [route]);
  const mobilePrefs = {
    ...prefs,
    nativeMobile: true,
    boardRotates,
    rotatePieces:
      c.mode === "local" && c.display.turn() === "b" && !boardRotates,
  };
  function notify(text) {
    setToast(text);
  }
  function refresh() {
    setSaved(read("games", []));
    setSolved(read("solved", []));
    setCompleted(read("progress", []));
  }
  function restoreGameRoute() {
    const mode = read("mobile-active-mode", "local");
    const archive = mode === "archive" && read("mobile-archive-pgn", "");
    if (archive) {
      c.loadPgn(archive);
      return true;
    }
    if (!c.restore(["bot", "coach"].includes(mode) ? mode : "local")) return false;
    const bot = currentBotProfile(c.getSnapshot());
    if (bot) {
      c.setBot(bot);
      setSelected(bot);
    }
    return true;
  }
  useEffect(() => {
    write("settings", prefs);
    configureMobileSound(prefs);
  }, [prefs]);
  useEffect(() => {
    write("mobile-board-rotates", boardRotates);
  }, [boardRotates]);
  useEffect(() => {
    const initialRoute = location.hash.slice(1);
    try {
      if (initialRoute === "game") {
        if (!restoreGameRoute()) {
          setRoute("home");
          location.hash = "home";
        }
      } else if (initialRoute === "analysis") {
        if (c.restoreAnalysis()) return;
        const pgn = read("mobile-analysis-pgn", "");
        if (pgn) {
          c.loadPgn(pgn, { analysis: true });
          c.goView(read("mobile-analysis-view", c.getSnapshot().moves.length));
        } else c.start({ mode: "analysis" });
      }
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    const snapshot = c.getSnapshot();
    if (route === "game" && (snapshot.started || snapshot.moves.length)) {
      write("mobile-active-mode", snapshot.bot?.coach && snapshot.mode === "bot" ? "coach" : snapshot.mode);
      if (snapshot.mode === "archive")
        write("mobile-archive-pgn", snapshot.pgn);
    }
    if (route === "analysis" && snapshot.mode === "analysis") {
      write("mobile-analysis-pgn", snapshot.pgn);
      write("mobile-analysis-view", snapshot.view);
    }
  }, [route, c.mode, c.pgn, c.view]);
  useEffect(() => {
    if (
      !onboarding && route === "analysis" &&
      prefs.quickAnalysis !== false &&
      c.mode === "analysis"
    )
      void c.getHint({ showHint: false });
  }, [route, onboarding, c.mode, c.id, c.display.fen(), c.analysis?.cursor, prefs.quickAnalysis]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const change = () => {
      const next = location.hash.slice(1) || "home";
      if (supported.has(next)) {
        if (next === "analysis" && c.getSnapshot().mode !== "analysis" && !c.restoreAnalysis())
          c.start({ mode: "analysis" });
        setExercise(false);
        setRoute(next);
        refresh();
      }
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    refresh();
  }, [route, c.result]);
  useEffect(() => {
    if (boardRotates && c.mode === "local") c.setFlipped(c.game.turn() === "b");
  }, [boardRotates, c.game.fen()]);
  function navigate(value) {
    if (value === "coach") {
      const origins = ["home", "new-game", "lessons"];
      if (origins.includes(route)) write("mobile-coach-origin", route);
      if (route === "game") {
        const origin = read("mobile-coach-origin", "new-game");
        navigate(origins.includes(origin) ? origin : "new-game");
      }
      setModal({ type: "coach", title: "Play Against Coach" });
      return;
    }
    if (value === "review" && route !== "review") write("mobile-review-origin", route);
    const next =
      {
        play: "bots",
        local: "local-setup",
        history: "history",
        Watch: "watch",
        practice: "practice",
        daily: "daily",
        rush: "rush",
      }[value] || value;
    if (value === "profile") {
      setModal({ type: "profile", title: "Profile" });
      return;
    }
    if (!supported.has(next)) {
      setModal({
        type: "soon",
        title:
          value === "online"
            ? "Play Online"
            : value === "friend"
              ? "Play a Friend"
              : value,
      });
      return;
    }
    if (next === "analysis" && c.getSnapshot().mode !== "analysis" && !c.restoreAnalysis())
      c.start({ mode: "analysis" });
    if (next === "position") {
      const fen = c.display.fen();
      setEditorFen(fen);
      setEditorVariant(c.variant);
      write("mobile-editor-fen", fen);
      write("mobile-editor-variant", c.variant);
    }
    setExercise(false);
    setError("");
    setRoute(next);
    location.hash = next;
    refresh();
  }
  function start(options) {
    try {
      c.start(options);
      write("mobile-active-mode", options.bot?.coach ? "coach" : options.mode || "local");
      setBoardRotates(!!options.boardRotates);
      setModal(null);
      navigate(options.mode === "analysis" ? "analysis" : "game");
    } catch (e) {
      setError(e.message || "Check the starting position and try again.");
    }
  }
  function newGameFromResult({ rematch }) {
    const botGame = c.mode === "bot";
    if (!rematch) return navigate(c.bot?.coach ? "coach" : botGame ? "bots" : "local-setup");
    const headers = c.game.getHeaders();
    start({
      mode: botGame ? "bot" : "local",
      bot: c.bot,
      side: c.side,
      flipped: botGame ? c.flipped : undefined,
      fen: c.base,
      variant: c.variant,
      names: { w: headers.White || "White", b: headers.Black || "Black" },
      timeControl: c.timeControl,
      increment: c.increment,
      boardRotates: !botGame && boardRotates,
    });
  }
  function continueBot() {
    if (c.restore("bot")) {
      const b = currentBotProfile(c.getSnapshot());
      if (b) {
        setSelected(b);
        c.setBot(b);
      }
      navigate("game");
    } else
      start({
        mode: "bot",
        bot: selected,
        side: "w",
        names: { w: prefs.name, b: selected.name },
      });
  }
  function review(pgn = c.pgn) {
    try { write("review-analysis-origin", route === "analysis" && c.analysis ? {pgn:c.pgn, mainPgn:parseReviewPgn(c.pgn).pgn} : null); }
    catch { write("review-analysis-origin", null); }
    setReviewPgn(pgn);
    write("review-pgn", pgn);
    navigate("review");
  }
  function returnFromReview() {
    const origin = read("mobile-review-origin", "history");
    if (origin === "game") {
      navigate(c.getSnapshot().moves.length || restoreGameRoute() ? "game" : "history");
    } else {
      navigate(["home", "more", "history", "stats", "analysis"].includes(origin) ? origin : "history");
    }
  }
  function leaveGame(returnToLatest = false) {
    const game = c.getSnapshot();
    if (returnToLatest && game.started && game.view < game.moves.length) {
      c.goView(game.moves.length);
      return;
    }
    navigate(game.bot?.coach ? "coach" : game.mode === "bot" ? "bots" : "home");
  }
  function analyze(fen, pgn, ply, branch) {
    try {
      if (route === "analysis" && pgn === c.pgn && fen === c.display.fen()) return;
      const source = pgn || branch?.sourcePgn;
      const origin = read("review-analysis-origin", null);
      let fullPgn = source;
      if (route === "review" && source && origin?.pgn && parseReviewPgn(source).pgn === origin.mainPgn) fullPgn = origin.pgn;
      if (fullPgn) c.loadPgn(fullPgn, { analysis: true });
      else c.loadFen(fen);
      if (branch) {
        if (!c.addAnalysisContinuation(branch.beforePly, branch.continuation)) throw new Error("Could not restore the suggested continuation.");
      } else if (Number.isInteger(ply)) {
        const target = c.getSnapshot().analysis?.mainPath[ply - 1] || "root";
        c.selectAnalysisNode(target);
      }
      setRoute("analysis");
      location.hash = "analysis";
    } catch (e) {
      notify(e.message);
    }
  }
  function importGame() {
    try {
      if (/^[rnbqkpRNBQKP1-8/]+ [wb] /.test(importValue.trim()))
        c.loadFen(importValue.trim());
      else c.loadPgn(importValue.trim(), { analysis: true });
      setModal(null);
      setRoute("analysis");
      location.hash = "analysis";
      setError("");
    } catch (e) {
      setError(e.message || "Enter a valid FEN or PGN.");
    }
  }
  async function chooseAnalysisFile(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const selection = ++importRead.current;
    if (file.size > 200000) {
      setError("Choose a PGN file no larger than 200 KB.");
      return;
    }
    try {
      const text = await file.text();
      if (input.isConnected && selection === importRead.current) {
        setImportValue(text);
        setError("");
      }
    } catch {
      if (input.isConnected && selection === importRead.current)
        setError("Could not read this PGN file.");
    }
  }
  const sessions = read("mobile-sessions-v1", {}),
    legacy = read("sessions", {});
  const hasBotSession =
    !!(sessions.bot || legacy.play)?.started &&
    !(sessions.bot || legacy.play)?.result;
  const hasLocalSession =
    !!(sessions.local || legacy.local)?.started &&
    !(sessions.local || legacy.local)?.result;
  const timeLabel =
    MOBILE_TIME_CONTROLS.find(([t, i]) => t === time && i === increment)?.[2] ||
    "10 min";
  const changePref = (key, value) => setPrefs((p) => ({ ...p, [key]: value }));
  const exerciseChanged = useCallback((active, back) => {
    setExercise(active);
    exerciseBack.current = active ? back : null;
  }, []);
  useEffect(() => {
    window.__chessNativeBack = () => {
      if (modal) {
        setModal(null);
        return true;
      }
      if (timeMenu) {
        setTimeMenu(false);
        return true;
      }
      const childEvent = new Event("chess-native-back", { cancelable: true });
      window.dispatchEvent(childEvent);
      if (childEvent.defaultPrevented) return true;
      if (route === "game") { leaveGame(true); return true; }
      if (route === "review") { returnFromReview(); return true; }
      if (onboarding) return false;
      if (exerciseBack.current) {
        exerciseBack.current();
        return true;
      }
      if (route === "home") return false;
      if (route === "openings" || route === "practice") {
        navigate("lessons");
        return true;
      }
      navigate(
        ["bots", "local-setup"].includes(route)
          ? "new-game"
          : route === "position"
            ? "analysis"
            : route === "new-game"
              ? "home"
              : ["settings", "appearance", "history", "stats"].includes(route)
                ? "more"
                : "home",
      );
      return true;
    };
    return () => {
      delete window.__chessNativeBack;
    };
  }, [route, modal, timeMenu, onboarding]);
  return onboarding ? <div className="android-app" data-mobile-route="welcome"><MobileOnboarding prefs={prefs} onFinish={({name,mode})=>{
    setPrefs(current=>({...current,name:name||"Guest"}));
    write("mobile-onboarding-v1",{version:1,complete:true,inProgress:false,mode});
    setOnboarding(false);
  }}/></div> : (
    <div className="android-app" data-mobile-route={route}>
      {route === "home" && (
        <MobileHome
          prefs={prefs}
          stats={{
            games: saved.length,
            solved: solved.length,
            lessons: completed.length,
          }}
          onNavigate={navigate}
        />
      )}
      {route === "new-game" && (
        <MobilePlayMenu
          onNavigate={navigate}
          timeLabel={timeLabel}
          onTime={() => setTimeMenu(true)}
        />
      )}
      {route === "bots" && (
        <MobileBots
          prefs={prefs}
          selected={selected}
          saved={saved}
          onSelect={(bot) => {
            const strength = read("mobile-stockfish-skill", adjustableBot.skill);
            const next = bot === adjustableBot ? { ...bot, skill: strength } : bot;
            setSelected(next);
            write("mobile-bot", next.id);
            if (next.id === adjustableBot.id) write("mobile-stockfish-skill", next.skill);
          }}
          onStart={start}
          onContinue={continueBot}
          hasSession={hasBotSession}
          onBack={() => navigate("new-game")}
          onUnavailable={(title,detail) => setModal({type:"soon",title,detail})}
        />
      )}
      {route === "local-setup" && (
        <MobileLocalSetup
          prefs={prefs}
          hasSession={hasLocalSession}
          onContinue={() => {
            if (c.restore("local")) navigate("game");
          }}
          onBack={() => navigate("new-game")}
          onStart={start}
          onNavigate={navigate}
        />
      )}
      {(route === "game" || route === "analysis") && (
        <>
          <MobileGameView
            controller={c}
            prefs={mobilePrefs}
            onBack={() => leaveGame()}
            onSettings={() =>
              setModal({ type: "board-settings", title: "Board" })
            }
            onReview={review}
            onAnalyze={analyze}
            onBoardRotatesChange={setBoardRotates}
            onNewGame={newGameFromResult}
          />
          {route === "analysis" && (
            <div className="am-analysis-tools">
              <button
                onClick={() => {
                  setImportValue("");
                  setModal({
                    type: "import",
                    title: "Load a game or position",
                  });
                }}
              >
                <Upload size={16} />
                Import PGN / FEN
              </button>
              <button onClick={() => review()} disabled={!c.moves.length}>
                Game Review
              </button>
              <button onClick={() => c.start({ mode: "analysis" })}>
                New Analysis
              </button>
              <button onClick={() => navigate("position")}>
                Set Up Position
              </button>
            </div>
          )}
        </>
      )}
      {route === "position" && (
        <MobilePositionEditor
          prefs={mobilePrefs}
          initialFen={editorFen}
            initialVariant={editorVariant}
          onClose={() => navigate("analysis")}
            onLoad={(fen, variant) => {
            write("mobile-editor-fen", fen);
              write("mobile-editor-variant", variant);
              c.loadFen(fen, variant);
              setRoute("analysis"); location.hash="analysis";
          }}
        />
      )}
      {route === "review" && (
        <MobileReview
          pgn={reviewPgn}
          prefs={mobilePrefs}
          selectedCoach={read("mobile-coach-setup", null)?.name}
          onBack={returnFromReview}
          onAnalyze={analyze}
          onPgnChange={(p) => {
            setReviewPgn(p);
            write("review-pgn", p);
          }}
        />
      )}
      {["settings", "appearance"].includes(route) && (
        <MobileSettings
          prefs={prefs}
          onChange={changePref}
          onBack={() => navigate("more")}
          onNavigate={navigate}
          section={route === "appearance" ? "theme" : undefined}
        />
      )}
      {["puzzles", "daily", "rush"].includes(route) && (
        <MobilePuzzles
          key={route}
          initialMode={
            route === "daily" ? "daily" : route === "rush" ? "rush" : "standard"
          }
          prefs={mobilePrefs}
          onBack={() => navigate("home")}
          onNavigate={navigate}
          onSolved={refresh}
          onExerciseChange={exerciseChanged}
        />
      )}
      {route === "lessons" && (
        <MobileLearn
          prefs={mobilePrefs}
          onBack={() => navigate("home")}
          onNavigate={navigate}
          onCompleted={refresh}
          onExerciseChange={exerciseChanged}
        />
      )}
      {route === "more" && <MobileMore onNavigate={navigate} />}
      {["history", "stats"].includes(route) && (
        <section className="am-history-screen">
          <MobileHeader
            title={route === "history" ? "Game History" : "Stats"}
            onBack={() => navigate("more")}
          />
          <div className="am-local-statistics">
            <div>
              <b>{saved.length}</b>
              <span>Games played</span>
            </div>
            <div>
              <b>{solved.length}</b>
              <span>Puzzles solved</span>
            </div>
            <div>
              <b>{completed.length}</b>
              <span>Lessons completed</span>
            </div>
          </div>
          <h2>Recent Games</h2>
          {!saved.length && (
            <div className="am-local-empty">
              <p>Finish a local game to save it here.</p>
              <button className="am-primary" onClick={() => navigate("bots")}>
                Play Bots
              </button>
              <button onClick={() => navigate("review")}>
                Import a game for review
              </button>
            </div>
          )}
          {saved.map((s) => (
            <article className="am-history-game" key={s.id}>
              <button
                onClick={() => {
                  try {
                    c.loadPgn(s.pgn);
                    navigate("game");
                  } catch (e) {
                    notify(e.message);
                  }
                }}
              >
                <b>{s.names ? `${s.names.w} vs. ${s.names.b}` : `You vs. ${s.opponent}`}</b>
                <span>{s.result}</span>
                {s.variant === "chess960" && <small>Chess960</small>}
                <small>{new Date(s.date).toLocaleDateString()}</small>
              </button>
              <button onClick={() => review(s.pgn)}>Game Review</button>
            </article>
          ))}
        </section>
      )}
      {route === "watch" && (
        <section className="am-online-screen">
          <MobileHeader title="Watch" icon="binoculars" />
          {["ChessTV", "Events", "Streamers", "Top Games"].map((name) => (
            <button
              className="am-online-row"
              key={name}
              onClick={() => setModal({ type: "soon", title: name })}
            >
              {name}
            </button>
          ))}
        </section>
      )}
      {["openings", "practice"].includes(route) && (
        <section className="am-library-screen">
          <MobileHeader
            title={route === "openings" ? "Openings" : "Endgames"}
            onBack={() => navigate("lessons")}
          />
          <LocalPractice kind={route} onStart={start} />
        </section>
      )}
      {tabRoutes.has(route) && !exercise && (
        <MobileTabs active={route} onNavigate={navigate} />
      )}
      {timeMenu && (
        <MobileTimePicker
          value={time}
          increment={increment}
          onSelect={(t, i) => {
            setTime(t);
            setIncrement(i);
          }}
          onClose={() => setTimeMenu(false)}
        />
      )}
      {error && (
        <div className="am-toast" role="alert">
          <span>{error}</span>
          <button onClick={() => setError("")} aria-label="Dismiss error">
            <X />
          </button>
        </div>
      )}
      {toast && (
        <div className="am-toast" role="status">
          {toast}
        </div>
      )}
      {modal && (
        <div
          className="am-root-backdrop"
          onClick={(e) => e.target === e.currentTarget && setModal(null)}
        >
          <section
            className={`am-root-dialog ${modal.type === "board-settings" ? "am-settings-dialog" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={modal.title}
          >
            <button
              className="am-root-close"
              onClick={() => setModal(null)}
              aria-label="Close"
            >
              <X />
            </button>
            {modal.type === "soon" && (
              <>
                <MobileColorIcon name="device-bot" />
                <h2>{modal.title}</h2>
                <h3>Coming Soon</h3>
                <p>
                  {modal.detail || "This feature needs an online service. Local play, puzzles, lessons, and your paired engine are available."}
                </p>
                <button
                  className="am-primary"
                  onClick={() => {
                    setModal(null);
                    navigate("bots");
                  }}
                >
                  Play Bots
                </button>
              </>
            )}
            {modal.type === "board-settings" && (
              <MobileSettings
                prefs={prefs}
                onChange={changePref}
                section="board"
                onBack={() => setModal(null)}
                onNavigate={navigate}
              />
            )}
            {modal.type === "coach" && coachSetup({ jsx, jsxs }, {
              initial: read("mobile-coach-setup", { name: "Sage", rating: 850, color: "w" }),
              saved: Boolean(sessions.coach?.started && !sessions.coach?.result),
              onResume: () => {
                if (c.restore("coach")) {
                  setModal(null);
                  navigate("game");
                }
              },
              onPlay: selection => {
                write("mobile-coach-setup", selection);
                const side = selection.color === "random" ? (Math.random() < .5 ? "w" : "b") : selection.color;
                const bot = { id: "coach:" + selection.name, name: selection.name, coach: true,
                  rating: selection.rating, skill: Math.min(20, Math.round(selection.rating / 125)) };
                start({ mode: "bot", bot, side,
                  names: { w: side === "w" ? prefs.name : bot.name, b: side === "b" ? prefs.name : bot.name } });
              },
            })}
            {modal.type === "profile" && (
              <>
                <h2>Profile</h2>
                <label>
                  Player name
                  <input
                    maxLength={40}
                    value={prefs.name}
                    onChange={(e) => changePref("name", e.target.value)}
                  />
                </label>
                <p>Saved on this device.</p>
                <button className="am-primary" onClick={() => setModal(null)}>
                  Save
                </button>
              </>
            )}
            {modal.type === "import" && (
              <>
                <h2>{modal.title}</h2>
                <textarea
                  aria-label="PGN or FEN"
                  value={importValue}
                  onChange={(event) => {
                    importRead.current++;
                    setImportValue(event.target.value);
                  }}
                  placeholder="Paste PGN or FEN"
                />
                <label className="am-import-file">
                  Choose PGN file
                  <input
                    type="file"
                    accept=".pgn,.txt,text/plain,application/x-chess-pgn"
                    onChange={chooseAnalysisFile}
                  />
                </label>
                <button className="am-primary" onClick={importGame}>
                  Load
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

import { openings, practice } from "../data";
function LocalPractice({ kind, onStart }) {
  return (
    <div className="am-local-library">
      {(kind === "openings" ? openings : practice).map((item) => (
        <button
          key={item.name || item.id}
          onClick={() => {
            if (kind === "openings") {
              const g = new Chess();
              for (const san of item.moves) g.move(san);
              onStart({ mode: "analysis", pgn: g.pgn() });
            } else onStart({ mode: "analysis", fen: item.fen });
          }}
        >
          <b>{item.name || item.title}</b>
          <small>{item.description || item.description}</small>
        </button>
      ))}
    </div>
  );
}
