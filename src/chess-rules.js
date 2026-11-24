import { Chess } from "chess.js";
import { parse } from "../node_modules/chess.js/src/pgn.js";
import { Chess960, validateChess960Position, chess960Fen } from "./chess960.js";
import { validatePosition } from "./gameplay.js";

export const STANDARD_FEN = new Chess().fen();
export function normalizePgnHeaders(input) {
  const headers = {};
  for (const [raw, value] of Object.entries(input)) {
    const key = ["FEN","Variant","SetUp","Result"].find(name=>name.toLowerCase()===raw.toLowerCase()) || raw;
    if (Object.hasOwn(headers,key)) throw new Error("Duplicate PGN structural header.");
    headers[key] = value;
  }
  return headers;
}
export function normalizeVariant(value) {
  if (!value || /^(standard|chess|from\s*position)$/i.test(value)) return "standard";
  if (/^(chess960|fischer\s*random|fischerandom)$/i.test(value)) return "chess960";
  throw new Error("This chess variant is not supported locally.");
}
export function variantForFen(fen, hint) {
  if (hint) return normalizeVariant(hint);
  return /[A-Ha-h]/.test(String(fen).trim().split(/\s+/)[2]?.replace(/[KQkq]/g, "") || "") ? "chess960" : "standard";
}
export function createRulesGame(fen, variant) {
  const family = variantForFen(fen, variant);
  return family === "chess960" ? new Chess960(fen || chess960Fen(518)) : new Chess(fen || STANDARD_FEN);
}
export function validateRulesPosition(fen, variant) {
  return variantForFen(fen, variant) === "chess960" ? validateChess960Position(fen) : validatePosition(fen);
}
export function readRulesPgn(pgn) {
  if (typeof pgn !== "string" || pgn.length > 200000) throw new Error("Choose a PGN smaller than 200 KB.");
  const headers = normalizePgnHeaders(parse(pgn).headers);
  const fen = Object.entries(headers).find(([key]) => key.toLowerCase() === "fen")?.[1];
  const declared = Object.entries(headers).find(([key]) => key.toLowerCase() === "variant")?.[1];
  const variant = variantForFen(fen, declared);
  const game = createRulesGame(fen, variant);
  game.loadPgn(pgn);
  validateRulesPosition(game.getHeaders().FEN || STANDARD_FEN, variant);
  return { game, variant, base: game.getHeaders().FEN || STANDARD_FEN };
}
