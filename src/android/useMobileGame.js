import { useEffect, useRef, useSyncExternalStore } from "react";
import { Chess } from "chess.js";
import { advanceClock, resultToken } from "../gameplay.js";
import { apiFetch } from "../mobile-api.js";
import { sound, selectMoveSound } from "../audio.js";
import { playHistoryMoveSound } from "./history-sound.js";
import { AnalysisTree } from "../analysis-tree.js";
import {createRulesGame,validateRulesPosition,variantForFen,readRulesPgn} from "../chess-rules.js";
import {chess960Start} from "../chess960.js";
import {botSearch, chooseOpponentMove, coachFeedback, coachHint} from "./offline-opponents.js";

const START = new Chess().fen();
const SESSION_KEY = "chess-local-mobile-sessions-v1";
const GAMES_KEY = "chess-local-games";
const storageDefault = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};
const uci = (m) => m.from + m.to + (m.promotion || "");
const objectMove = (m) =>
  typeof m === "string"
    ? { from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] }
    : { from: m.from, to: m.to, promotion: m.promotion };
function endReason(g) {
  if (g.isCheckmate())
    return `${g.turn() === "w" ? "Black" : "White"} wins by checkmate`;
  if (g.isStalemate()) return "Draw by stalemate";
  if (g.isThreefoldRepetition()) return "Draw by repetition";
  if (g.isInsufficientMaterial()) return "Draw — insufficient material";
  if (g.isDraw()) return "Draw — fifty-move rule";
  return "";
}

/**
 * Local rules/session controller, separate from reference mobile presentation.
 * Time is charged from wall-clock timestamps, including throttled background
 * intervals. Route suspension is explicit and pauses local practice clocks.
 * Bot strength uses the existing local Stockfish mapping, not proprietary bots.
 */
export function createMobileGameController({
  storage = storageDefault(),
  request = apiFetch,
  now = Date.now,
  playSound = (event) => sound.play(event),
  unlockSound = () => sound.unlock(),
} = {}) {
  const read = (key, fallback) => {
    try {
      return JSON.parse(storage?.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key, value) => {
    try {
      storage?.setItem(key, JSON.stringify(value));
    } catch {}
  };
  const listeners = new Set();
  let active = true,
    disposed = false,
    initialized = false,
    revision = 0,
    hintRevision = 0,
    nonce = 0;
  let botController = null,
    hintController = null,
    anchor = now(),
    clockHistory = [];
  let game = new Chess(), analysisTree = null,
    snapshot;
  let state = {
    base: START,
    variant: "standard",
    mode: "local",
    bot: null,
    side: "w",
    flipped: false,
    started: false,
    paused: false,
    result: "",
    timeControl: 0,
    increment: 0,
    clocks: { w: 600, b: 600 },
    view: 0,
    busy: false,
    hintBusy: false,
    error: "",
    hint: "",
    engine: null,
    id: `mobile-${now()}-${++nonce}`,
    names: { w: "White", b: "Black" },
  };
  function rebuild(count = game.history().length) {
    const board = createRulesGame(state.base, state.variant);
    game
      .history({ verbose: true })
      .slice(0, count)
      .forEach((m) => board.move(objectMove(m)));
    for (const [key, value] of Object.entries(game.getHeaders()))
      board.setHeader(key, value);
    return board;
  }
  function persist() {
    if (initialized && state.mode === "analysis" && analysisTree) {
      write("chess-local-mobile-analysis-v1", {
        version: 1, pgn: analysisTree.pgn(),
        path: analysisTree.line().map(id => analysisTree.nodes[id].uci),
        view: state.view, flipped: state.flipped,
      });
      return;
    }
    if (!initialized || !["local", "bot"].includes(state.mode)) return;
    const sessions = read(SESSION_KEY, {});
    sessions[state.mode === "bot" && state.bot?.coach ? "coach" : state.mode] = {
      version: 1,
      ...state,
      moves: game.history({ verbose: true }).map(uci),
      headers: game.getHeaders(),
      fen: game.fen(),
      clockHistory,
      // Requests are resumed explicitly; pending native handles never persist.
      busy: false,
      hintBusy: false,
      error: "",
      hint: "",
      engine: null,
    };
    write(SESSION_KEY, sessions);
  }
  function emit(persistState = true) {
    if (disposed) return;
    const moves = game.history({ verbose: true });
    state.view = Math.max(0, Math.min(state.view, moves.length));
    snapshot = {
      ...state,
      active,
      game,
      moves,
      display: rebuild(state.view),
      pgn: analysisTree ? analysisTree.pgn() : game.pgn(),
      linePgn: game.pgn(),
      analysis: analysisTree?.snapshot(state.view) || null,
      lastMove: moves[state.view - 1] || null,
      canMove:
        active &&
        !state.paused &&
        !state.result &&
        (state.mode === "analysis" ||
          (state.started &&
            state.view === moves.length &&
            !state.busy &&
            (state.mode === "local" ||
              (state.mode === "bot" && game.turn() === state.side)))),
    };
    if (persistState) persist();
    for (const listener of listeners) listener();
  }
  function cancelHint() {
    hintRevision++;
    hintController?.abort();
    hintController = null;
    state.hintBusy = false;
    state.hint = "";
  }
  function cancelWork() {
    revision++;
    botController?.abort();
    botController = null;
    state.busy = false;
    state.coachFeedback = "";
    state.coachHintFen = "";
    state.coachHintMove = "";
    cancelHint();
  }
  function archive() {
    if (!game.history().length) return;
    const record = {
      id: state.id,
      date: new Date(now()).toISOString(),
      opponent:
        state.mode === "bot" ? state.bot?.name || "Computer" : "Local player",
      result: state.result,
      pgn: game.pgn(),
      base: state.base,
      mode: state.mode,
      variant: state.variant,
      names: {...state.names},
    };
    const games = read(GAMES_KEY, []);
    write(
      GAMES_KEY,
      [record, ...games.filter((g) => g.id !== record.id)].slice(0, 100),
    );
  }
  function finish(text) {
    if (state.result || !["local", "bot"].includes(state.mode)) return;
    cancelWork();
    state.result = text;
    state.started = false;
    state.paused = false;
    game.setHeader("Result", resultToken(text));
    archive();
    playSound(
      text.startsWith("Draw")
        ? "game-draw"
        : state.mode === "local"
          ? "game-end"
          : text.startsWith(state.side === "w" ? "White" : "Black")
            ? "game-win"
            : "game-lose",
    );
    emit();
  }
  function charge() {
    const time = now(),
      elapsed = Math.max(0, time - anchor);
    anchor = time;
    if (
      !active ||
      !state.started ||
      state.paused ||
      state.result ||
      !state.timeControl
    )
      return false;
    state.clocks = advanceClock(state.clocks, game.turn(), elapsed);
    if (state.clocks[game.turn()] <= 0) {
      finish(`${game.turn() === "w" ? "Black" : "White"} wins on time`);
      return true;
    }
    return false;
  }
  async function engineRequest(
    fen,
    controller,
    { skill = 20, movetime = 250, multiPv = 1, purpose = "hint", depth } = {},
  ) {
    const response = await request("/api/engine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ fen, skill, movetime, multiPv, purpose, depth, ...(state.variant === "chess960" ? {variant:"chess960"} : {}) }),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        data.error?.message ||
          data.error ||
          "Engine unavailable. Check your computer connection.",
      );
    return data;
  }
  function commit(move, opponent = false) {
    if (charge()) return false;
    const turn = game.turn(),
      beforeClocks = { ...state.clocks };
    const next = rebuild();
    let made;
    try {
      made = next.move(objectMove(move));
    } catch {
      return false;
    }
    const follow = state.view === game.history().length;
    clockHistory.push(beforeClocks);
    if (state.timeControl && state.mode !== "analysis")
      state.clocks = {
        ...state.clocks,
        [turn]: state.clocks[turn] + state.increment,
      };
    game = next;
    anchor = now();
    if (follow || !opponent) state.view = game.history().length;
    state.hint = "";
    state.error = "";
    state.engine = null;
    const result = endReason(game);
    if (result && state.mode !== "analysis") {
      finish(result);
      return true;
    }
    if (state.mode === "analysis") game.setHeader("Result", "*");
    playSound(selectMoveSound(made, false, opponent));
    emit();
    pump();
    return true;
  }
  function pump() {
    if (
      disposed ||
      !active ||
      !state.started ||
      state.paused ||
      state.result ||
      state.busy ||
      state.error ||
      state.mode !== "bot" ||
      !state.bot ||
      game.turn() === state.side
    )
      return;
    if (charge()) return;
    const token = revision,
      fen = game.fen(),
      controller = new AbortController();
    botController = controller;
    state.busy = true;
    emit();
    const skill = Math.max(
      0,
      Math.min(20, Number.isInteger(state.bot?.skill) ? state.bot.skill : 10),
    );
    const profile = state.bot;
    const lastPlayerMove = game.history({ verbose: true }).at(-1);
    async function searchOpponent() {
      if (profile.coach && lastPlayerMove?.color === state.side) {
        const options = { purpose: "coach-feedback", movetime: 115 };
        const before = await engineRequest(lastPlayerMove.before, controller, options);
        const after = await engineRequest(fen, controller, options);
        if (!controller.signal.aborted && revision === token && game.fen() === fen) {
          state.coachFeedback = coachFeedback(lastPlayerMove, before, after, state.variant);
          emit();
        }
      }
      return engineRequest(fen, controller, botSearch(profile, skill));
    }
    searchOpponent()
      .then((data) => {
        if (
          disposed ||
          token !== revision ||
          controller.signal.aborted ||
          !active ||
          !state.started ||
          state.paused ||
          state.result ||
          game.fen() !== fen
        )
          return;
        state.busy = false;
        botController = null;
        if (
          !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(data.bestmove || "") ||
          !commit(chooseOpponentMove(game, data, profile), true)
        ) {
          if (!state.result) {
            state.error = "The engine returned an invalid move. Try again.";
            emit();
          }
        }
      })
      .catch((error) => {
        if (disposed || token !== revision || controller.signal.aborted) return;
        botController = null;
        state.busy = false;
        state.error = error.message || "The engine connection failed.";
        emit();
      });
  }
  function start(options = {}) {
    if (disposed) throw new Error("This game controller has been disposed.");
    const mode = options.mode || "local";
    if (!["bot", "local", "analysis"].includes(mode))
      throw new Error("Unsupported game mode.");
    const parsed = options.pgn ? readRulesPgn(options.pgn) : null;
    const variant = parsed?.variant || variantForFen(options.fen, options.variant);
    const generated = !options.pgn && !options.fen && variant === "chess960" ? chess960Start(options.chess960Index) : null;
    const initialFen = options.fen || generated?.fen || START;
    const nextTree = mode === "analysis" ? new AnalysisTree({pgn: options.pgn, fen: initialFen, variant}) : null;
    const board = nextTree ? nextTree.board() : parsed?.game || validateRulesPosition(initialFen, variant);
    const base = nextTree?.base || parsed?.base || board.fen();
    const side = options.side === "b" ? "b" : "w";
    const seconds = Number(options.timeControl ?? 0),
      increment = Number(options.increment ?? 0);
    if (
      !Number.isFinite(seconds) ||
      seconds < 0 ||
      seconds > 86400 ||
      !Number.isFinite(increment) ||
      increment < 0 ||
      increment > 600
    )
      throw new Error("Invalid time control.");
    cancelWork();
    initialized = true;
    game = board;
    analysisTree = nextTree;
    clockHistory = [];
    anchor = now();
    const names = options.names || {
      w:
        mode === "bot" && side === "b"
          ? options.bot?.name || "Computer"
          : "White",
      b:
        mode === "bot" && side === "w"
          ? options.bot?.name || "Computer"
          : "Black",
    };
    state = {
      ...state,
      base,
      variant,
      chess960Index: generated?.index ?? options.chess960Index ?? null,
      mode,
      bot: options.bot || null,
      side,
      flipped: options.flipped ?? side === "b",
      started: mode !== "analysis",
      paused: false,
      result: "",
      timeControl: seconds,
      increment,
      clocks: { w: seconds || 600, b: seconds || 600 },
      view: game.history().length,
      busy: false,
      hintBusy: false,
      error: "",
      hint: "",
      engine: null,
      id: `mobile-${now()}-${++nonce}`,
      names,
    };
    if (!options.pgn) {
      game.setHeader(
        "Event",
        mode === "local" ? "Local friendly game" : "Computer practice",
      );
      game.setHeader("White", names.w);
      game.setHeader("Black", names.b);
      if (options.bot?.coach) game.setHeader("Coach", options.bot.name);
      game.setHeader(
        "Date",
        new Date(now()).toISOString().slice(0, 10).replaceAll("-", "."),
      );
      game.setHeader("Result", "*");
      if (seconds) game.setHeader("TimeControl", `${seconds}+${increment}`);
    }
    if (analysisTree) analysisTree.headers = {...game.getHeaders()};
    unlockSound();
    if (mode !== "analysis") playSound("game-start");
    const result = endReason(game);
    if (result && mode !== "analysis") finish(result);
    else emit(!options.archive);
    pump();
    return snapshot;
  }
  function restore(mode = "local") {
    const modern = read(SESSION_KEY, {});
    const legacy = read("chess-local-sessions", {});
    const record = modern[mode] || (mode !== "coach" && legacy[mode === "bot" ? "play" : "local"]);
    if (!record || !Array.isArray(record.moves)) return false;
    try {
      const variant = record.variant || variantForFen(record.base, record.headers?.Variant);
      const restored = validateRulesPosition(record.base || START, variant);
      record.moves.forEach((move) => restored.move(objectMove(move)));
      for (const [key, value] of Object.entries(record.headers || {}))
        restored.setHeader(key, value);
      cancelWork();
      initialized = true;
      game = restored;
      analysisTree = null;
      anchor = now();
      clockHistory = record.clockHistory || [];
      state = {
        ...state,
        ...record,
        mode: mode === "coach" ? "bot" : mode,
        variant,
        base: record.base || START,
        bot: typeof record.bot === "object" ? record.bot : null,
        botId: typeof record.bot === "string" ? record.bot : record.bot?.id,
        side: record.side === "b" ? "b" : "w",
        view: Math.min(record.view ?? record.moves.length, record.moves.length),
        started: !!record.started && !record.result,
        paused: !!record.paused,
        result: record.result || "",
        busy: false,
        hintBusy: false,
        coachHintFen: "",
        coachHintMove: "",
        error: "",
        hint: "",
        engine: null,
        clocks: record.clocks || {
          w: record.timeControl || 600,
          b: record.timeControl || 600,
        },
        names: record.names || {
          w: game.getHeaders().White || "White",
          b: game.getHeaders().Black || "Black",
        },
      };
      if (state.result) game.setHeader("Result", resultToken(state.result));
      emit();
      pump();
      return true;
    } catch {
      return false;
    }
  }
  function applyMove(from, to, promotion = "q") {
    if (!snapshot.canMove) return false;
    cancelHint();
    if (state.mode === "analysis" && analysisTree) {
      try {
        const parent = analysisTree.line()[state.view - 1] || "root";
        const added = analysisTree.add(parent, {from,to,promotion});
        game = analysisTree.board();
        state.view = added.ply;
        state.engine = null; state.error = "";
        playSound(selectMoveSound(added.move));
        emit();
        return true;
      } catch {
        playSound("illegal");
        return false;
      }
    }
    const okay = commit({ from, to, promotion });
    if (!okay && !state.result) playSound("illegal");
    return okay;
  }
  function goView(ply) {
    if (!Number.isInteger(ply)) return;
    cancelHint();
    const next = Math.max(0, Math.min(ply, game.history().length));
    if (next !== state.view) state.engine = null;
    if (next !== state.view && next > 0) {
      const move = game.history({ verbose: true })[next - 1];
      const opponent = state.mode === "bot" && move.color !== state.side;
      playHistoryMoveSound(playSound, move, opponent);
    }
    state.view = next;
    emit();
  }
  function undo() {
    if (state.mode === "analysis" && analysisTree) {
      if (!state.view) return false;
      goView(state.view - 1);
      return true;
    }
    if (
      !["local", "bot", "analysis"].includes(state.mode) ||
      !game.history().length
    )
      return false;
    charge();
    cancelWork();
    const count = Math.max(
      0,
      game.history().length -
        (state.mode === "bot" && game.turn() === state.side ? 2 : 1),
    );
    game = rebuild(count);
    game.setHeader("Result", "*");
    state.clocks = { ...(clockHistory[count] || state.clocks) };
    clockHistory = clockHistory.slice(0, count);
    state.view = count;
    state.result = "";
    state.error = "";
    state.engine = null;
    state.started = state.mode !== "analysis";
    state.paused = false;
    anchor = now();
    write(
      GAMES_KEY,
      read(GAMES_KEY, []).filter((record) => record.id !== state.id),
    );
    playSound("move-self");
    emit();
    pump();
    return true;
  }
  function pause() {
    if (!state.started || state.paused || charge()) return;
    cancelWork();
    state.paused = true;
    emit();
  }
  function resume() {
    if (!state.started || !state.paused || state.result) return;
    state.paused = false;
    anchor = now();
    emit();
    pump();
  }
  function setActive(value) {
    const next = !!value;
    if (disposed || next === active) return;
    if (!next) {
      charge();
      cancelWork();
    }
    active = next;
    anchor = now();
    emit();
    if (active) pump();
  }
  async function getHint({ showHint = true } = {}) {
    if (!active || state.paused || state.result || state.busy || state.hintBusy)
      return null;
    cancelHint();
    const controller = new AbortController(),
      token = hintRevision,
      fen = snapshot.display.fen(),
      view = state.view;
    hintController = controller;
    state.hintBusy = true;
    state.error = "";
    emit();
    try {
      const data = await engineRequest(fen, controller, {
        multiPv: state.mode === "analysis" ? 3 : 1,
      });
      if (
        disposed ||
        token !== hintRevision ||
        controller.signal.aborted ||
        !active ||
        state.view !== view ||
        snapshot.display.fen() !== fen
      )
        return null;
      if (showHint && state.bot?.coach) {
        const reveal = state.coachHintFen === fen;
        state.hint = reveal ? state.coachHintMove : "";
        state.coachFeedback = reveal ? "Try the highlighted move." : coachHint(snapshot.display, data.bestmove);
        state.coachHintMove = state.hint || data.bestmove;
        state.coachHintFen = fen;
      } else {
        state.hint = showHint ? data.bestmove || "" : "";
      }
      state.engine = data;
      state.hintBusy = false;
      hintController = null;
      emit();
      return data;
    } catch (error) {
      if (!disposed && token === hintRevision && !controller.signal.aborted) {
        state.hintBusy = false;
        hintController = null;
        state.error = error.message;
        emit();
      }
      return null;
    }
  }
  function loadPgn(pgn, { analysis = false } = {}) {
    const {game:board} = readRulesPgn(pgn);
    start({ mode: "analysis", pgn, archive: !analysis });
    if (!analysis) {
      state.mode = "archive";
      state.started = false;
      state.result =
        board.getHeaders().Result === "*"
          ? ""
          : { "1-0": "White wins", "0-1": "Black wins", "1/2-1/2": "Draw" }[
              board.getHeaders().Result
            ] || "";
      emit();
    }
  }
  function restoreAnalysis() {
    const saved = read("chess-local-mobile-analysis-v1", null);
    if (!saved?.pgn || saved.version !== 1) return false;
    try {
      start({mode:"analysis", pgn:saved.pgn});
      analysisTree.selectPath(saved.path);
      game = analysisTree.board();
      state.view = Math.max(0, Math.min(Number(saved.view) || 0, game.history().length));
      state.flipped = !!saved.flipped;
      emit();
      return true;
    } catch { return false; }
  }
  function selectAnalysisNode(id) {
    if (state.mode !== "analysis" || !analysisTree?.nodes[id]) return false;
    if (snapshot.analysis?.cursor === id) return true;
    cancelWork();
    state.view = analysisTree.select(id);
    game = analysisTree.board();
    state.engine = null; state.error = "";
    if (state.view > 0) {
      playHistoryMoveSound(playSound, game.history({ verbose: true })[state.view - 1]);
    }
    emit(); return true;
  }
  function promoteAnalysisNode(id) {
    if (state.mode !== "analysis" || !analysisTree?.nodes[id]) return false;
    analysisTree.promote(id);
    if (snapshot.analysis?.cursor === id) { game = analysisTree.board(); emit(); return true; }
    return selectAnalysisNode(id);
  }
  function removeAnalysisNode(id) {
    if (state.mode !== "analysis" || !analysisTree) return false;
    const parent = analysisTree.remove(id);
    return parent !== false && selectAnalysisNode(parent);
  }
  function annotateAnalysisNode(id, notes) {
    if (state.mode !== "analysis" || !analysisTree) return false;
    const changed = analysisTree.annotate(id, notes);
    if (changed) emit();
    return changed;
  }
  function addAnalysisContinuation(beforePly, moves) {
    if (state.mode !== "analysis" || !analysisTree || !Number.isInteger(beforePly)) return false;
    const path = analysisTree.line({main:true});
    if (beforePly < 0 || beforePly > path.length) return false;
    const result = analysisTree.addContinuation(path[beforePly - 1] || "root", moves);
    cancelWork(); state.view = result.ply;
    game = analysisTree.board(); state.engine = null; state.error = "";
    emit(); return true;
  }
  function setFlipped(value) {
    state.flipped = typeof value === "boolean" ? value : !state.flipped;
    emit();
  }
  function retryEngine() {
    if (!active || state.result) return;
    state.error = "";
    emit();
    if (state.mode === "analysis" || state.mode === "local") return getHint({ showHint: state.mode !== "analysis" });
    pump();
  }
  function setBot(bot) {
    state.bot = bot;
    state.botId = bot?.id;
    emit();
    pump();
  }
  function tick() {
    if (disposed) return;
    const previous = state.clocks;
    const ended = charge();
    if (!ended && previous !== state.clocks) emit();
  }
  function dispose() {
    if (disposed) return;
    charge();
    cancelWork();
    persist();
    disposed = true;
    listeners.clear();
  }
  emit();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start,
    restore,
    restoreAnalysis,
    selectAnalysisNode,
    promoteAnalysisNode,
    removeAnalysisNode,
    annotateAnalysisNode,
    addAnalysisContinuation,
    applyMove,
    goView,
    undo,
    pause,
    resume,
    setActive,
    getHint,
    retryEngine,
    setFlipped,
    setBot,
    loadPgn,
    loadFen: (fen, variant) => start({ mode: "analysis", fen, variant }),
    tick,
    dispose,
    resign: (color = state.mode === "bot" ? state.side : game.turn()) => {
      if (!state.started || charge()) return;
      finish(`${color === "w" ? "Black" : "White"} wins by resignation`);
    },
    agreeDraw: () => {
      if (state.started && !charge()) finish("Draw by agreement");
    },
  };
}

export function useMobileGame({ active = true, ...dependencies } = {}) {
  const ref = useRef(null);
  const lifecycle = useRef(0);
  if (!ref.current) ref.current = createMobileGameController(dependencies);
  const controller = ref.current;
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    controller.setActive(active);
  }, [active, controller]);
  useEffect(() => {
    const mounted = ++lifecycle.current;
    const timer = setInterval(controller.tick, 250);
    const tick = () => controller.tick();
    const configured = () => controller.retryEngine();
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("pagehide", tick);
    window.addEventListener("chess-engine-configured", configured);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("pagehide", tick);
      window.removeEventListener("chess-engine-configured", configured);
      controller.setActive(false);
      // React Strict Mode rehearses effect teardown/setup. A synchronous teardown
      // would permanently dispose the controller that the rehearsal reuses.
      queueMicrotask(() => {
        if (lifecycle.current === mounted) controller.dispose();
      });
    };
  }, [controller]);
  return { ...snapshot, ...controller };
}
