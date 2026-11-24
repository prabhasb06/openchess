import { Chess } from "chess.js";

// Teaching PGNs intentionally contain simplified, kingless positions. Their
// parser must keep annotation directives separate from ordinary PGN moves.
export function readTeachingPgn(pgn = "") {
  const tags = Object.fromEntries(
    [...pgn.matchAll(/^\s*\[([A-Z_]+) "((?:[^"\\]|\\.)*)"\]/gim)].map((m) => [
      m[1],
      m[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\"),
    ]),
  );
  const clean = (text) =>
    text
      .replace(/\[%[^\]]*\]/g, "")
      .replace(/\\"/g, '"')
      .trim();
  const directive = (text, name) =>
    text.match(new RegExp("\\[%" + name + " ([^\\]]+)\\]"))?.[1] || "";
  const raw = pgn.replace(/^\s*\[[^\n]*\]\s*$/gm, "");
  const comments = [],
    moves = [],
    moveNotes = [];
  let depth = 0;
  for (const token of raw.match(/\{[^}]*\}|[()]|[^\s(){}]+/g) || []) {
    if (token === "(") {
      depth++;
      continue;
    }
    if (token === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth) continue;
    if (token.startsWith("{")) {
      const comment = token.slice(1, -1);
      comments.push(comment);
      if (moveNotes.length) {
        const note = moveNotes.at(-1);
        note.text = clean(comment);
        note.hint = directive(comment, "hint");
        note.wrong = directive(comment, "wrong");
      }
      continue;
    }
    const san = token.replace(/^\d+\.(?:\.\.)?/, "").replace(/[!?]+$/, "");
    if (
      !san ||
      /^\$\d+$/.test(san) ||
      ["*", "1-0", "0-1", "1/2-1/2", "..."].includes(san)
    )
      continue;
    moves.push(san);
    moveNotes.push({ san, text: "", hint: "", wrong: "" });
  }
  const arrows = [];
  for (const c of comments)
    for (const m of c.matchAll(/\[%c_arrow ([^\]]+)\]/g))
      for (const part of m[1].split(",")) {
        const move = part.match(/^([a-h][1-8])([a-h][1-8])/);
        if (move) arrows.push([move[1], move[2]]);
      }
  return {
    tags,
    fen: tags.FEN || "8/8/8/8/8/8/8/4K3 w - - 0 1",
    text: clean(comments[0] || ""),
    success: moveNotes.at(-1)?.text || "",
    hint: moveNotes[0]?.hint || "",
    wrong: moveNotes[0]?.wrong || "",
    moves,
    moveNotes,
    arrows,
    stars: (tags.LESSON_STAR_LOCATIONS || "").split(/[, ]+/).filter(Boolean),
  };
}
export function teachingScreens(data, questionIndex = 0) {
  return (data.content || [])
    .filter((group) => (group.questionIndex || 0) === questionIndex)
    .flatMap((group) => group.screens || []);
}
export function teachingGame(fen) {
  return new Chess(fen, { skipValidation: true });
}
export function resetTeachingTurn(game, color) {
  const fields = game.fen().split(" ");
  fields[1] = color;
  game.load(fields.join(" "), { skipValidation: true });
}
