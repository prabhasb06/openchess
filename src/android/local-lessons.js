function challenge(fen, stars, instruction) {
  return `[FEN "${fen}"]\n[LESSON_CHALLENGE_TYPE "captureTheStar"]\n[LESSON_STAR_LOCATIONS "${stars}"]\n\n{${instruction}} *`;
}

const lessons = [
  ["the-king", "King steps", "8/8/8/8/4K3/8/8/8 w - - 0 1", "d5", "The king moves one square at a time. Step diagonally to d5."],
  ["the-queen", "Queen lines", "8/8/8/8/1Q6/8/8/8 w - - 0 1", "f8", "The queen moves along a clear file, rank, or diagonal. Follow the diagonal to f8."],
  ["the-rook", "Rook lanes", "8/8/8/8/8/2R5/8/8 w - - 0 1", "c8", "A rook stays on its file or rank. Move straight up the c-file."],
  ["the-bishop", "Bishop diagonals", "8/8/8/8/8/8/1B6/8 w - - 0 1", "g7", "The bishop always stays on the same square color. Follow the diagonal to g7."],
  ["the-knight", "Knight jumps", "8/8/8/8/8/8/4N3/8 w - - 0 1", "f4", "The knight jumps two squares in one direction and one across. Land on f4."],
  ["the-pawn", "Pawn advances", "8/8/8/8/8/8/2P5/8 w - - 0 1", "c4", "A pawn can move two squares from its starting rank when both squares are clear."],
];

export const localLessons = lessons.map(([path, name, fen, stars, introText]) => ({
  id: path,
  path,
  name,
  fen,
  introText,
  outroText: "You found the target. The next lesson is ready.",
  questions: [challenge(fen, stars, introText)],
}));
