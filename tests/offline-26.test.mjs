import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { botSearch, chooseOpponentMove, coachFeedback, coachHint } from "../src/android/offline-opponents.js";
import { classifyMove, sacrificeCapture, runGameReview } from "../src/review-model.js";
import { analyzePosition } from "../server.mjs";

const uci = move => move.from + move.to + (move.promotion || "");
const score = (evaluation, bestmove) => ({ evaluation, bestmove, mate:null });
function seeded(seed) {
  return () => ((seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 2**32);
}

test("beginner, intermediate and advanced move choices separate at every stage with either color", async () => {
  const positions = [
    new Chess().fen(),
    "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
    "7k/5Q2/5K2/8/8/8/8/8 w - - 0 1",
    "8/8/8/8/8/5k2/5q2/7K b - - 0 1",
    "8/5pk1/8/3K4/4P3/8/8/8 w - - 0 1",
    "8/5pk1/8/3K4/4P3/8/8/8 b - - 0 1",
  ];
  const totals = [0, 0, 0, 0];
  for (const fen of positions) {
    const board = new Chess(fen);
    const legal = new Set(board.moves({ verbose:true }).map(uci));
    const result = await analyzePosition({ fen, skill:20, movetime:60 });
    const rates = [250, 1300, 1950, 2800].map((rating, tier) => {
      const random = seeded(738463);
      const sampled = Array.from({length:360}, () => chooseOpponentMove(board, result, {rating}, random));
      assert(sampled.every(move => legal.has(move)));
      const weaker = sampled.filter(move => move !== result.bestmove).length;
      totals[tier] += weaker;
      return weaker;
    });
    assert(rates[0] > rates[1] && rates[1] > rates[2] && rates[2] > rates[3], rates.join(", "));
  }
  assert.equal(botSearch({rating:2800}, 10).skill, 20);
  assert.equal(botSearch({rating:250}, 0).depth, 5);
  console.log("Non-top choices out of 2160 per tier:", totals);
});

test("review evidence gates special classes and uses both perspectives", () => {
  const move = { from:"d1", to:"d4", color:"w" };
  assert.equal(classifyMove(move, score(2, "d1d4"), score(1.9), 12, {sacrifice:true, alternative:.61}).classification, "Brilliant");
  assert.equal(classifyMove(move, score(2, "a2a3"), score(-2), 12, {sacrifice:true, alternative:.61}).classification, "Blunder");
  assert.equal(classifyMove(move, score(2, "d1d4"), score(1.9), 12, {alternative:.73}).classification, "Best");
  assert.equal(classifyMove(move, score(2, "d1d4"), score(1.9), 12, {alternative:.45}).classification, "Great");
  assert.equal(classifyMove(move, score(2, "a2a3"), score(0), 12, {missedChance:true}).classification, "Miss");
  assert.equal(classifyMove(move, score(2, "d1d4"), score(1.9), 1, {sacrifice:true, alternative:.45}).classification, "Forced");
  assert.equal(classifyMove({...move, color:"b"}, score(-2, "a2a3"), score(0), 12, {missedChance:true}).classification, "Miss");
  const board = new Chess("4k3/8/8/4p3/3p4/8/8/3RK3 w - - 0 1");
  const offer = board.move("Rxd4");
  assert.equal(sacrificeCapture(offer)?.san, "exd4");
  const recaptureBoard = new Chess("4k3/8/8/4p3/3r4/8/8/3RK3 w - - 0 1");
  assert.equal(sacrificeCapture(recaptureBoard.move("Rxd4")), null);
});

test("coach clues and comments name the legal moves Stockfish found", () => {
  const board = new Chess();
  assert.match(coachHint(board, "g1f3"), /knight on g1/);
  const move = board.move("f3");
  assert.match(coachFeedback(move, score(.3, "g1f3"), score(-.75, "e7e5"), "standard"), /e5.*Nf3/);
});

test("real Stockfish distinguishes a sound smothered-mate sacrifice from a queen giveaway", async () => {
  for (const [rank, brilliant] of [["4Q2N", true], ["4Q3", false]]) {
    const board = new Chess(`1q3r1k/6pp/${rank}/8/8/8/8/4K3 w - - 0 1`);
    board.move("Qg8+");
    const report = await runGameReview(board.pgn(), {
      adaptive: true,
      request: async (_, options) => ({
        ok: true,
        json: () => analyzePosition(JSON.parse(options.body), options.signal),
      }),
    });
    assert.equal(report.moves[0].classification === "Brilliant", brilliant);
  }
});

test("real Stockfish reviews mate by both colors and supports constrained searches", async () => {
  for (const [pgn, winner] of [["1. f3 e5 2. g4 Qh4# 0-1", "b"], ["1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0", "w"]]) {
    const result = await runGameReview(pgn, { movetime:80, request: async (_, opts) =>
      ({ ok:true, json: () => analyzePosition(JSON.parse(opts.body), opts.signal) }) });
    assert.equal(result.moves.at(-1).afterEval.winner, winner);
  }
  const result = await analyzePosition({fen:new Chess().fen(), rootMove:"a2a3", movetime:80, skill:20});
  assert.equal(result.bestmove, "a2a3");
});
