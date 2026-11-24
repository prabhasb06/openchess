import { sound } from "../audio";

// Short synthesized tones composed for Chess Local.
const sample = (name) => `/chess-local/audio/${name}.wav`;
export const ANDROID_SOUND_ASSETS = Object.freeze(
  Object.fromEntries(
    Object.entries({
      "move-self": "tap",
      "move-opponent": "reply",
      capture: "capture",
      "move-check": "check",
      "move-self-check": "check",
      "move-opponent-check": "check",
      castle: "special",
      promote: "special",
      illegal: "error",
      correct: "success",
      incorrect: "error",
      "puzzle-correct": "success",
      "puzzle-correct-2": "success",
      "puzzle-wrong": "error",
      "game-start": "notice",
      "game-end": "end",
      "game-win-long": "success",
      "game-lose": "end",
      "game-lose-long": "end",
      "game-draw": "end",
      tenseconds: "notice",
      premove: "tap",
      "lesson-fail": "error",
      notify: "notice",
    }).map(([event, name]) => [event, sample(name)]),
  ),
);

export function configureMobileSound(prefs = {}) {
  sound.setPreferences({
    enabled: prefs.sound !== false,
    volume: prefs.volume ?? 0.8,
    theme: "chess-local",
    themeAssets: ANDROID_SOUND_ASSETS,
  });
}
export { sound as mobileSound };
