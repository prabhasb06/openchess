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
  assert.deepEqual(progress.findLast(step => step.phase === 'positions'), { phase: 'positions', completed: 5, total: 5, percent: 75 });
  assert.deepEqual(progress.at(-2), { phase: 'moves', completed: 4, total: 4, percent: 99 });
  assert.deepEqual(progress.at(-1), { phase: 'complete', completed: 4, total: 4, percent: 100 });
  assert(progress.every((step, i) => !i || step.percent >= progress[i - 1].percent));
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

test('an interrupted review can reuse its completed searches on retry', async () => {
  const controller = new AbortController();
  const searches = [];
  const pgn = '1. e4 e5 *';
  const request = async (_, options) => {
    const search = JSON.parse(options.body);
    searches.push(search);
    return { ok: true, json: async () => ({
      bestmove: search.fen.includes(' b ') ? 'e7e5' : 'e2e4',
      evaluation: .2,
    }) };
  };
  await assert.rejects(runGameReview(pgn, {
    request, signal: controller.signal, reuse: true,
    onProgress: ({completed}) => { if (completed === 1) controller.abort(); },
  }), {name: 'AbortError'});
  assert.equal(searches.length, 1);

  const report = await runGameReview(pgn, {request, reuse: true});
  assert.equal(report.moves.length, 2);
  assert.equal(searches.length, 3);

  await runGameReview(pgn, {request});
  assert.equal(searches.length, 6);
  await runGameReview(pgn, {request: (...args) => request(...args), reuse: true});
  assert.equal(searches.length, 9);
});

test('pipelined analysis keeps positions in PGN order even if the second reply arrives first', async () => {
  const parsed = parseReviewPgn('1. e4 e5 *');
  const replies = [];
  let firstReply;
  const response = (evaluation, bestmove) => ({
    ok: true,
    json: async () => { replies.push(evaluation); return {evaluation, bestmove}; },
  });
  const report = await runGameReview(parsed.pgn, {
    prefetch: true,
    request: async (_, options) => {
      const {fen} = JSON.parse(options.body);
      if (fen === parsed.base) return new Promise(resolve => { firstReply = resolve; });
      if (fen === parsed.positions[1]) {
        return { ok: true, json: async () => {
          replies.push(2);
          firstReply(response(1, 'e2e4'));
          return {evaluation:2, bestmove:'e7e5'};
        } };
      }
      return response(3, 'g1f3');
    },
  });
  assert.deepEqual(replies, [2, 1, 3]);
  assert.deepEqual(report.evaluations.map(result => result.evaluation), [1, 2, 3]);
});

test('cancelling a pipelined review also aborts the queued engine search', async () => {
  const controller = new AbortController();
  const searches = [];
  let queuedSearchAborted = false;
  const review = runGameReview('1. e4 e5 *', {
    prefetch: true,
    signal: controller.signal,
    onProgress: ({phase, completed}) => {
      if (phase === 'positions' && completed === 1) controller.abort();
    },
    request: async (_, options) => {
      searches.push(options.signal);
      if (searches.length === 1) return {ok:true, json:async()=>({bestmove:'e2e4',evaluation:.2})};
      return new Promise((_, reject) => {
        options.signal.addEventListener('abort', () => {
          queuedSearchAborted = true;
          reject(new DOMException('Search cancelled.', 'AbortError'));
        }, {once:true});
      });
    },
  });
  await assert.rejects(review, {name:'AbortError'});
  assert.equal(searches.length, 2);
  assert(queuedSearchAborted);
});

test('adjacent moves share a deep evaluation and still report a missed opportunity', async () => {
  const parsed = parseReviewPgn('1. e4 e5 *');
  const searches = [];
  const report = await runGameReview(parsed.pgn, {
    adaptive: true,
    prefetch: true,
    request: async (_, options) => {
      const search = JSON.parse(options.body);
      searches.push(search);
      const index = parsed.positions.indexOf(search.fen);
      return {ok:true, json:async()=>({
        bestmove: ['d2d4', 'c7c5', 'g1f3'][index],
        evaluation: [1.6, .3, .52][index],
        depth: 14,
      })};
    },
  });
  assert.equal(report.moves[0].classification, 'Miss');
  assert.deepEqual(searches.filter(search => search.fen === parsed.positions[1]).map(search => search.movetime), [50, 95]);
});

test('review reuses an evaluated capture and verifies its continuation', async () => {
  const parsed = parseReviewPgn('[SetUp "1"]\n[FEN "1q3r1k/6pp/4Q2N/8/8/8/8/4K3 w - - 0 1"]\n\n1. Qg8+ *');
  for (const [response, depth, expectExtra, verifiedBefore, strongProbe] of [
    ['h6f7', 18, false, false, false],
    ['h6f7', 10, true, false, false],
    ['e2e4', 18, true, false, false],
    ['h6f7', 18, false, true, false],
    ['h6f7', 18, false, true, true],
    ['h6f7', 18, false, false, true],
  ]) {
    const searches = [];
    const report = await runGameReview(parsed.pgn, {
      adaptive: true,
      request: async (_, options) => {
        const search = JSON.parse(options.body);
        searches.push(search);
        const opening = { pv: verifiedBefore ? ['e6g8', 'f8g8', 'h6f7'] : ['e6g8'], mate: 3, depth: 18 };
        const result = search.fen === parsed.base
          ? { bestmove: 'e6g8', mate: 3, lines: [opening, { pv: ['e6d7'], score: .4, depth: strongProbe ? 18 : 10 }] }
          : search.fen === parsed.positions[1]
            ? { bestmove: 'f8g8', mate: 2, depth: strongProbe ? depth : 0, lines: [{ pv: ['f8g8', response], depth, mate: 2 }] }
            : { bestmove: 'h6f7', mate: 2 };
        return { ok: true, json: async () => result };
      },
    });
    assert.equal(report.moves[0].classification, 'Brilliant');
    const verification = strongProbe ? [150] : [150, 425];
    const expected = [...verification, ...(verifiedBefore ? [] : verification), ...(expectExtra ? [320] : [])];
    assert.deepEqual(searches.filter(search => search.movetime > 65).map(search => search.movetime), expected);
    assert(searches.every(search => !search.rootMove));
  }
});
