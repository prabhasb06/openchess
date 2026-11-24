import { Chess } from "chess.js";

export function advanceClock(clocks, turn, elapsedMs, increment = 0) {
  return {
    ...clocks,
    [turn]:
      Math.max(0, clocks[turn] - Math.max(0, elapsedMs) / 1000) + increment,
  };
}

export function moveRows(moves) {
  const rows = [];
  moves.forEach((move, index) => {
    const number = Number(
      move.before?.split(" ")[5] || Math.floor(index / 2) + 1,
    );
    let row = rows.at(-1);
    if (!row || row.number !== number) rows.push((row = { number }));
    row[move.color === "b" ? "black" : "white"] = { move, index };
  });
  return rows;
}

export function resultToken(text) {
  if (text.startsWith("White wins")) return "1-0";
  if (text.startsWith("Black wins")) return "0-1";
  if (text.startsWith("Draw")) return "1/2-1/2";
  return "*";
}

export function validatePosition(fen) {
  const game = new Chess(fen);
  const pieces = game.board().flat().filter(Boolean);
  const white = pieces.find((p) => p.type === "k" && p.color === "w");
  const black = pieces.find((p) => p.type === "k" && p.color === "b");
  if (
    !white ||
    !black ||
    (Math.abs(white.square.charCodeAt(0) - black.square.charCodeAt(0)) <= 1 &&
      Math.abs(Number(white.square[1]) - Number(black.square[1])) <= 1)
  ) {
    throw new Error("Place one king per side on non-adjacent squares.");
  }
  if (pieces.some((p) => p.type === "p" && ["1", "8"].includes(p.square[1])))
    throw new Error("Pawns cannot be placed on the first or eighth rank.");
  const waitingKing = game.turn() === "w" ? black : white;
  if (game.isAttacked(waitingKing.square, game.turn()))
    throw new Error(
      "The side that just moved cannot leave its own king in check. Change the position or side to move.",
    );
  const rights = fen.split(" ")[2] || "-";
  for (const [right, king, rook, color] of [
    ["K", "e1", "h1", "w"],
    ["Q", "e1", "a1", "w"],
    ["k", "e8", "h8", "b"],
    ["q", "e8", "a8", "b"],
  ]) {
    if (
      rights.includes(right) &&
      (game.get(king)?.type !== "k" ||
        game.get(king)?.color !== color ||
        game.get(rook)?.type !== "r" ||
        game.get(rook)?.color !== color)
    )
      throw new Error(
        "Castling rights require a king and rook on their starting squares.",
      );
  }
  return game;
}
