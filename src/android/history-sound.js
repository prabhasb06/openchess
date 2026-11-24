import { selectMoveSound } from "../audio.js";

// The Android board-history dispatcher distinguishes CHECK from MATE.
// A mating history entry schedules its ordinary move sound and GAME_END.
export function playHistoryMoveSound(playSound, move, opponent = false) {
  if (!move) return;
  const san = move.san || "";
  const mate = san.endsWith("#");
  const moveSound = mate ? { ...move, san: san.slice(0, -1) } : move;
  playSound(selectMoveSound(moveSound, false, opponent));
  if (mate) playSound("game-end");
}
