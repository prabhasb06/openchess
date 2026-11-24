import { Chess } from "chess.js";
import { createRulesGame, validateRulesPosition, variantForFen } from "../chess-rules.js";

export const START_POSITION = new Chess().fen();

export function positionDraft(fen = START_POSITION, variant) {
  const family = variantForFen(fen, variant);
  const game = createRulesGame(fen, family);
  const fields = game.fen({forceEnpassantSquare:true}).split(/\s+/);
  return {
    variant: family,
    pieces: Object.fromEntries(
      game
        .board()
        .flat()
        .filter(Boolean)
        .map((p) => [p.square, p.color + p.type]),
    ),
    turn: fields[1],
    castling: fields[2] === "-" ? "" : fields[2],
    enPassant: fields[3],
    halfmove: fields[4],
    fullmove: fields[5],
  };
}

export function draftFen(draft) {
  const rows = [..."87654321"].map((rank) => {
    let row = "",
      empty = 0;
    for (const file of "abcdefgh") {
      const piece = draft.pieces[file + rank];
      if (!piece) {
        empty++;
        continue;
      }
      if (empty) {
        row += empty;
        empty = 0;
      }
      row += piece[0] === "w" ? piece[1].toUpperCase() : piece[1];
    }
    return row + (empty || "");
  });
  const rights =
    [...(draft.variant === "chess960" ? "HGFEDCBAhgfedcba" : "KQkq")].filter((right) => draft.castling.includes(right)).join("") ||
    "-";
  return `${rows.join("/")} ${draft.turn} ${rights} ${draft.enPassant || "-"} ${draft.halfmove} ${draft.fullmove}`;
}

/** Checks structural standard-chess legality, not historical reachability. */
export function validateEditorPosition(fen, variant) {
  const fields = fen.trim().split(/\s+/);
  if (fields.length !== 6)
    throw new Error(
      "A FEN needs six fields: pieces, turn, castling, en passant, and two move counters.",
    );
  if (!/^\d+$/.test(fields[4]) || !Number.isSafeInteger(Number(fields[4])))
    throw new Error("Halfmove clock must be a whole number of zero or more.");
  if (!/^[1-9]\d*$/.test(fields[5]) || !Number.isSafeInteger(Number(fields[5])))
    throw new Error("Move number must be a whole number of one or more.");
  const game = validateRulesPosition(fields.join(" "), variant);
  for (const color of ["w", "b"]) {
    const pieces = game
      .board()
      .flat()
      .filter((p) => p?.color === color);
    if (pieces.length > 16 || pieces.filter((p) => p.type === "p").length > 8)
      throw new Error(
        `${color === "w" ? "White" : "Black"} can have at most sixteen pieces and eight pawns.`,
      );
  }
  if (fields[3] !== "-") {
    const target = fields[3],
      file = target[0],
      turn = fields[1];
    const pawnRank = turn === "w" ? "5" : "4",
      originRank = turn === "w" ? "7" : "2";
    const pawn = game.get(file + pawnRank);
    if (
      game.get(target) ||
      !pawn ||
      pawn.type !== "p" ||
      pawn.color === turn ||
      game.get(file + originRank)
    )
      throw new Error(
        "The en passant square must be behind an opposing pawn that just advanced two squares.",
      );
    if (Number(fields[4]) !== 0)
      throw new Error(
        "The halfmove clock must be zero after an en passant pawn advance.",
      );
  }
  return game.fen({ forceEnpassantSquare: true });
}
