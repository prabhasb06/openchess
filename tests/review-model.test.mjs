import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReviewPgn, classifyMove, evaluationValue, runGameReview } from '../src/review-model.js';
import { analyzePosition } from '../server.mjs';

test('review parses only a legal single game, including nonstandard black-to-move starts', () => {
  assert.throws(() => parseReviewPgn(''), /Paste/);
  assert.throws(() => parseReviewPgn('1. e5'), /PGN/);
  assert.throws(() => parseReviewPgn('[Event "No moves"]'), /no moves/);
  const pgn = '[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/8/4K2R b - - 0 15"]\n\n15... Kd7 16. Rh7+';
  const parsed = parseReviewPgn(pgn);
  assert.equal(parsed.moves[0].color, 'b');
  assert.equal(parsed.positions.length, 3);
  assert.equal(parsed.base.split(' ')[5], '15');
});

test('grading respects both colors and terminal mate perspective', () => {
  const move = { from: 'e7', to: 'e5', color: 'b' };
  const score = evaluation => ({ evaluation, mate: null, bestmove: 'd7d5' });
  assert.equal(classifyMove(move, score(-2), score(1), 20).classification, 'Blunder');
  assert.equal(classifyMove(move, score(2), score(-1), 20).loss, 0);
  assert.equal(classifyMove(move, { ...score(-2), bestmove: 'e7e5' }, score(1), 20).classification, 'Best');
  assert.equal(classifyMove(move, score(0), score(0), 1).classification, 'Forced');
  assert.equal(evaluationValue({ mate: 0, winner: 'b' }), -100);
  assert.equal(evaluationValue({ mate: 0, winner: 'w' }), 100);
});

test('full real Stockfish review detects fools mate and a losing move', async () => {
  const progress = [];
  const report = await runGameReview('1. f3 e5 2. g4 Qh4# 0-1', {
    movetime: 100,
    onProgress: p => progress.push(p),
    request: async (_, options) => ({ ok: true, status: 200, json: () => analyzePosition(JSON.parse(options.body), options.signal) }),
  });
  assert.equal(report.moves.length, 4);
  assert.equal(report.moves[2].classification, 'Blunder');
  assert.equal(report.moves[3].classification, 'Best');
  assert.equal(report.moves[3].afterEval.winner, 'b');
  assert.match(report.moves[3].explanation, /checkmate/);
  assert.ok(report.accuracy.b > report.accuracy.w);
  assert.equal(Object.values(report.counts.w).reduce((a,b)=>a+b,0), 2);
  assert.equal(progress.at(-1).completed, 5);
});

test('repetition is evaluated as a draw without an engine search of the final FEN', async () => {
  let calls = 0;
  const report = await runGameReview('1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8 1/2-1/2', {
    request: async () => { calls++; return { ok: true, json: async () => ({ bestmove:'e2e4', evaluation:.1, mate:null, lines:[] }) }; },
  });
  assert.equal(calls, 8);
  assert.equal(report.moves.at(-1).afterEval.evaluation, 0);
  assert.match(report.moves.at(-1).explanation, /repetition/);
});

test('cancelled and failed reviews cannot produce partial success reports', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runGameReview('1. e4', { signal:controller.signal, request:()=>{throw Error('must not request')} }), e=>e.name==='AbortError');
  await assert.rejects(runGameReview('1. e4', { request:async()=>({ ok:false,status:503,json:async()=>({error:'Engine disconnected'}) }) }), /Engine disconnected/);
  await assert.rejects(runGameReview('1. e4', { request:async()=>({ok:true,json:async()=>({})}) }), /incomplete/);
});

test('a one-sided game reports no invented accuracy for the other side', async () => {
  const report = await runGameReview('1. e4 *', { request:async()=>({ok:true,json:async()=>({bestmove:'e2e4',evaluation:.2,mate:null,lines:[]})}) });
  assert.equal(report.accuracy.b, null);
  assert.equal(report.accuracy.w, 100);
});
