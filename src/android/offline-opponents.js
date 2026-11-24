import { createRulesGame } from "../chess-rules.js";

const value = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const piece = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const uci = move => move.from + move.to + (move.promotion || "");
const unpack = move => ({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] });

export function botSearch(profile, skill) {
  const rating = Number(profile?.rating || 0);
  const depth = rating < 1000 ? 5 : rating < 1550 ? 9 : undefined;
  return {
    purpose: profile?.coach ? "coach" : "bot",
    skill: rating >= 2350 ? 20 : skill,
    multiPv: rating < 2200 ? 3 : 1,
    movetime: rating < 1000 ? 95 : rating < 1550 ? 140 : 250,
    ...(depth ? { depth } : {}),
  };
}

export function chooseOpponentMove(board, data, profile, random = Math.random) {
  const rating = Number(profile?.rating);
  const best = data.bestmove;
  if (!Number.isFinite(rating) || rating >= 2350) return best;
  const weakness = Math.max(0, (2200 - rating) / 2050);
  const probability = Math.min(.94, .93 * weakness ** 1.35);
  if (random() >= probability) return best;
  const moves = board.moves({ verbose: true }).filter(move => uci(move) !== best);
  if (!moves.length) return best;
  const candidates = new Set(data.lines?.map(line => line.pv?.[0]) || []);
  // A fallible player sees captures, checks, development, and threats near the destination.
  const weights = moves.map(move => {
    const center = 4 - Math.abs(move.to.charCodeAt(0) - 100.5);
    const development = /^[nb]$/.test(move.piece) && /[18]$/.test(move.from) ? .5 : 0;
    const risk = board.attackers(move.to, move.color === "w" ? "b" : "w").length;
    const enginePreference = candidates.has(uci(move)) ? 1 - .75 * weakness : 0;
    const appeal = center * .14 + development + enginePreference + (move.captured ? value[move.captured] * .5 : 0)
      + (/[+#]$/.test(move.san) ? .65 : 0)
      - Math.min(1, risk) * value[move.piece] * (.38 - .29 * weakness);
    return Math.exp(Math.max(-3, Math.min(3, appeal)));
  });
  let threshold = random() * weights.reduce((a, b) => a + b, 0);
  return uci(moves.find((_, index) => (threshold -= weights[index]) < 0) || moves.at(-1));
}

export function coachHint(board, bestmove) {
  if (!bestmove) return "Look for a safe move that improves one of your pieces.";
  const target = unpack(bestmove);
  const moving = board.get(target.from);
  const capture = board.get(target.to);
  if (capture && capture.color !== moving?.color) return `Look for a way to capture the ${piece[capture.type]} on ${target.to}.`;
  return moving ? `Look for an active move with your ${piece[moving.type]} on ${target.from}.` : "Look for a safe move that improves one of your pieces.";
}

export function coachFeedback(move, before, reply, variant) {
  if (!move) return "";
  const beforeBoard = createRulesGame(move.before, variant);
  const afterBoard = createRulesGame(move.after, variant);
  if (afterBoard.isCheckmate()) return `${move.san} gives checkmate. Well played.`;
  if (afterBoard.isDraw()) return `${move.san} reaches a drawn position.`;
  if (before.bestmove === uci(move)) return `${move.san} is the strongest move I found.`;
  const sign = move.color === "w" ? 1 : -1;
  const drop = ((before.evaluation ?? 0) - (reply.evaluation ?? 0)) * sign;
  const forcedMate = reply.mate != null && reply.mate * sign < 0;
  try {
    const improved = beforeBoard.move(unpack(before.bestmove));
    const response = afterBoard.move(unpack(reply.bestmove));
    if (forcedMate) return `${move.san} allows a forced mate starting with ${response.san}. Consider ${improved.san} instead.`;
    if (drop >= .75 && response.captured) return `After ${move.san}, I can play ${response.san}, capturing your ${piece[response.captured]}. Consider ${improved.san} instead.`;
    if (drop >= .45) return `${move.san} lets me reply with ${response.san}. Compare it with ${improved.san}.`;
    return `${move.san} keeps the position close to my preferred move, ${improved.san}.`;
  } catch {
    return `After ${move.san}, review the position for your opponent’s strongest reply.`;
  }
}

export function coachSetup(ui, { coaches, saved, initial, onResume, onPlay }) {
  const select = (field, title, options, selected) => ui.jsxs("label", {
    children: [title, ui.jsx("select", {
      name: field, defaultValue: selected,
      children: options.map(([key, label]) => ui.jsx("option", { value: key, children: label }, key)),
    })],
  });
  return ui.jsxs("form", {
    className: "am-coach-form",
    onSubmit: event => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      onPlay({ name: values.get("coach"), rating: Number(values.get("strength")), color: values.get("color") });
    },
    children: [
      ui.jsx("h2", { children: "Play Against Coach" }),
      select("coach", "Coach", coaches.map(name => [name, name]), initial.name),
      select("strength", "Playing strength", [[400, "Beginner · 400"], [850, "Developing · 850"], [1300, "Intermediate · 1300"], [1750, "Advanced · 1750"], [2250, "Expert · 2250"]], initial.rating),
      select("color", "Play as", [["w", "White"], ["b", "Black"], ["random", "Random"]], initial.color),
      saved && ui.jsx("button", { type: "button", onClick: onResume, children: "Continue Coach Game" }),
      ui.jsx("button", { type: "submit", className: "am-primary", children: saved ? "Start New Coach Game" : "Play Coach Game" }),
    ],
  });
}
