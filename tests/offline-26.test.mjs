import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { botSearch, chooseOpponentMove, coachFeedback, coachHint } from "../src/android/offline-opponents.js";
import { adjustableBot, mobileBots } from "../src/android/local-bots.js";
import { classifyMove, sacrificeCapture, runGameReview } from "../src/review-model.js";
import { analyzePosition } from "../server.mjs";

const uci = move => move.from + move.to + (move.promotion || "");
const score = (evaluation, bestmove) => ({ evaluation, bestmove, mate:null });
function seeded(seed) {
  return () => ((seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 2**32);
}

test("beginner bots choose less reliably across openings, tactics and endings for both colors", async () => {
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
    const result = await analyzePosition({ fen, skill:20, multiPv:3, movetime:100 });
    const ratings = [300, 1200, 1800, 2200];
    const rates = ratings.map((rating, tier) => {
      const random = seeded(738463);
      const sampled = Array.from({length:160}, () => chooseOpponentMove(board, result, {rating}, random));
      assert(sampled.every(move => legal.has(move)));
      const weaker = sampled.filter(move => move !== result.bestmove).length;
      totals[tier] += weaker;
      return weaker;
    });
    assert(rates[0] > rates[1] && rates[1] > rates[2] && rates[3] === 0, rates.join(", "));
  }
  assert.equal(botSearch({rating:2800}, 10).skill, 20);
  assert.equal(botSearch({rating:250}, 0).depth, 5);
  console.log("Non-top choices out of 960 per tier:", totals);
});

test("Stockfish strength at maximum has enough time to search beyond beginner depth", async () => {
  const minimum = botSearch(adjustableBot, 0);
  const maximum = botSearch(adjustableBot, 20);
  assert.equal(minimum.skill, 0);
  assert.equal(maximum.skill, 20);
  assert(maximum.movetime > minimum.movetime);
  assert.equal(maximum.depth, undefined);
  assert.equal(chooseOpponentMove(new Chess(), {bestmove:"e2e4"}, adjustableBot, () => 0), "e2e4");
  const result = await analyzePosition({fen:new Chess().fen(), ...maximum});
  assert(result.depth > 5);

  const rated = mobileBots.filter(bot => bot.rating).slice(0, 5);
  const depths = rated.map(bot => botSearch(bot, bot.skill).depth);
  assert(depths.every((depth, index) => !index || depth >= depths[index - 1]));
  assert(depths.at(-1) > depths[0]);
});

test("advanced opponents keep a winning move when the other legal options lose for either color", () => {
  for (const fen of [
    "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
    "rnb1k1nr/pppp1ppp/8/2b1p3/4P2q/2N2N2/PPPP1PPP/R1BQKB1R b KQkq - 4 4",
  ]) {
    const board = new Chess(fen);
    const legal = board.moves({verbose:true});
    const mates = legal.filter(move => move.san.endsWith("#"));
    assert.equal(mates.length, 1);
    const mate = uci(mates[0]);
    const wrong = uci(legal.find(move => uci(move) !== mate));
    const data = {bestmove:mate, lines:[{pv:[mate], mate:board.turn() === "w" ? 1 : -1}, {pv:[wrong], score:0}]};
    assert.equal(chooseOpponentMove(board, data, {rating:1800}, () => 0), mate);
    assert.notEqual(chooseOpponentMove(board, data, {rating:300}, () => 0), mate);
  }
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
