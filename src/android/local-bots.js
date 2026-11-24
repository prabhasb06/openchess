export const adjustableBot = {
  id: "local-engine",
  name: "Stockfish",
  skill: 10,
  text: "Choose the engine strength for this game.",
};

export const mobileBots = [
  { id: "local-pebble", name: "Pebble", rating: 300, skill: 0, text: "Want to try a quiet opening?" },
  { id: "local-orbit", name: "Orbit", rating: 600, skill: 3, text: "I like loose pawns and open files." },
  { id: "local-quill", name: "Quill", rating: 900, skill: 6, text: "Let’s see which of us controls the center." },
  { id: "local-signal", name: "Signal", rating: 1200, skill: 9, text: "I’ll keep an eye out for forcing moves." },
  { id: "local-tandem", name: "Tandem", rating: 1500, skill: 13, text: "Ready for a positional game?" },
  { id: "local-vector", name: "Vector", rating: 1800, skill: 17, text: "I’m ready for a longer calculation." },
  { id: "local-apex", name: "Apex", rating: 2200, skill: 20, text: "Let’s play at full strength." },
  adjustableBot,
];
