// Phrase text comes from the retained public BotGroupService response. Event
// selection is a local reconstruction; it does not reproduce a remote bot AI.
export function botDialogue(bot, game, playerColor, result = "") {
  const phrases = bot.phrases || {};
  const history = game.history({ verbose: true });
  const last = history.at(-1);
  const botColor = playerColor === "w" ? "b" : "w";
  const fallback = phrases.greeting || bot.text || "Ready for a game?";
  if (result || game.isGameOver()) {
    if (result.startsWith("Draw") || game.isDraw())
      return phrases.draw || "Good game!";
    const winner = result.startsWith("White wins")
      ? "w"
      : result.startsWith("Black wins")
        ? "b"
        : game.turn() === "w" ? "b" : "w";
    return phrases[winner === botColor ? "won" : "lost"] || "Good game!";
  }
  if (!last) return fallback;
  const botMoved = last.color === botColor;
  const events = [];
  if (last.promotion) events.push(botMoved ? "promotingPawn" : "playerPawnPromote");
  if (last.captured === "q") events.push(botMoved ? "capturingQueen" : "queenCaptured");
  if (game.isCheck()) events.push(botMoved ? "givingCheck" : "beingChecked");
  if (last.captured && history.filter((m) => m.captured).length === 1)
    events.push("firstCapture");
  if (history.length <= 2) {
    const sequence = history.map((m) => m.san).join(" ");
    const openings = {
      "e4": "openingE4", "d4": "openingD4", "c4": "openingC4English", "Nf3": "openingNf3",
      "e4 e5": "openingE4E5KingsPawn", "e4 c5": "openingE4C5Sicilian",
      "e4 c6": "openingE4C6Carokann", "e4 e6": "openingE4E6French",
      "d4 Nf6": "openingD4Nf6Indian", "d4 d5": "openingD4D5QueensGambit",
    };
    events.push(openings[sequence] || "openingOther");
  }
  if (history.length >= 8) events.push("random");
  return events.map((event) => phrases[event]).find(Boolean) || fallback;
}
