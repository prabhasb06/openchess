import { createRulesGame, readRulesPgn } from './chess-rules.js';
import { apiFetch, mobileServer } from './mobile-api.js';

export const REVIEW_VERSION = 2;
export const REVIEW_CLASSES = ['Brilliant', 'Great', 'Best', 'Excellent', 'Good', 'Inaccuracy', 'Mistake', 'Miss', 'Blunder', 'Forced'];

export function parseReviewPgn(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Paste a PGN or finish a game to start a review.');
  if (input.length > 200000) throw new Error('This PGN is too large. Import one game at a time.');
  let loaded;
  try { loaded = readRulesPgn(input); } catch { throw new Error('The PGN could not be read. Check its variant, moves and starting position.'); }
  const { game, variant, base } = loaded;
  const headers = game.getHeaders();
  const history = game.history({ verbose: true });
  if (!history.length) throw new Error('This game has no moves to review.');
  if (history.length > 600) throw new Error('Review supports up to 600 half-moves per game.');
  const moves = history.map(({ san, color, from, to, promotion, before, after, piece, captured, flags, castle, kingTo, rookFrom, rookTo }) =>
    ({ san, color, from, to, promotion, before, after, piece, captured, flags, ...(castle ? {castle, kingTo, rookFrom, rookTo} : {}) }));
  return { pgn: game.pgn(), variant, headers, base, moves, positions: [base, ...moves.map(m => m.after)] };
}

export function evaluationValue(result) {
  if (result.winner) return result.winner === 'w' ? 100 : -100;
  if (result.mate !== null && result.mate !== undefined) return Math.sign(result.mate) * (100 - Math.min(50, Math.abs(result.mate)) * .01);
  return Number.isFinite(result.evaluation) ? result.evaluation : 0;
}

export function expectedScore(result, color) {
  const score = evaluationValue(result) * (color === 'w' ? 1 : -1);
  return 1 / (1 + Math.exp(-score * .95));
}

export function classifyMove(move, before, after, legalCount, evidence = {}) {
  const uci = move.from + move.to + (move.promotion || '');
  const best = before.bestmove === uci;
  const start = expectedScore(before, move.color), finish = expectedScore(after, move.color);
  const loss = best ? 0 : Math.max(0, start - finish);
  let classification = best ? 'Best' : loss < .02 ? 'Excellent' : loss < .05 ? 'Good'
    : loss < .10 ? 'Inaccuracy' : loss < .20 ? 'Mistake' : 'Blunder';
  if (legalCount === 1) classification = 'Forced';
  else if (evidence.sacrifice && loss < .02 && finish >= .40 && evidence.alternative < .90) classification = 'Brilliant';
  else if (best && evidence.alternative != null && start >= .43 && start - evidence.alternative >= .22) classification = 'Great';
  else if (!best && evidence.missedChance && start >= .78 && finish < .65) classification = 'Miss';
  return { classification, loss };
}

const pieceValue = {p: 1, n: 3, b: 3, r: 5, q: 9, k: 0};
const pieceName = {p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen'};
const moveUci = move => move.from + move.to + (move.promotion || '');
const gradeBoundaries = [.02, .05, .10, .20];

export function sacrificeCapture(move, variant, board) {
  if (move.castle || move.promotion || pieceValue[move.piece] < 3) return null;
  if (pieceValue[move.piece] - (pieceValue[move.captured] || 0) < 2) return null;
  const position = board ?? createRulesGame(move.after, variant);
  if (!position.attackers(move.to, position.turn()).length) return null;
  const reply = position.moves({ verbose: true })
    .find(candidate => candidate.to === move.to && candidate.captured === move.piece);
  return reply ?? null;
}

function sanLine(fen, pv, variant) {
  const board = createRulesGame(fen, variant), out = [];
  for (const uci of (pv || []).slice(0, 10)) {
    try { out.push(board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san); }
    catch { break; }
  }
  return out;
}

function verifiesContinuation(result, fen, prefix, variant) {
  const line = result.lines?.[0];
  const length = prefix.length + 1;
  return line?.depth >= 12 && Array.isArray(line.pv) &&
    prefix.every((move, index) => line.pv[index] === move) &&
    sanLine(fen, line.pv.slice(0, length), variant).length === length;
}

function stableGrade(first, refined, after) {
  const uncertainty = .012 + Math.abs(refined - first);
  const loss = Math.max(0, refined - after);
  return gradeBoundaries.every(boundary => Math.abs(loss - boundary) > uncertainty);
}

function resultExplanation(move, board) {
  if (board.isCheckmate()) return `${move.san} delivers checkmate.`;
  if (board.isDraw()) return `${move.san} reaches a drawn position${board.isStalemate() ? ' by stalemate' : board.isThreefoldRepetition() ? ' by repetition' : board.isInsufficientMaterial() ? ' with insufficient material' : ''}.`;
  return null;
}

function explanation(move, grading, bestSan, after) {
  if (grading.classification === 'Forced') return `${move.san} was the only legal move in this position.`;
  if (grading.classification === 'Brilliant') return `${move.san} offers a ${pieceName[move.piece]}. The engine checked the capture and found enough compensation.`;
  if (grading.classification === 'Great') return `${move.san} was critical. The other moves give up a substantial part of the position’s value.`;
  if (grading.classification === 'Miss') return `${move.san} lets a winning opportunity slip. Try ${bestSan} and follow the suggested continuation.`;
  if (grading.classification === 'Best') return `${move.san} matches Stockfish’s top choice.${move.captured ? ' It captures material while maintaining the strongest evaluation.' : ' Follow the suggested line to explore the continuation.'}`;
  const mateAgainst = after.mate != null && after.mate !== 0 && (Math.sign(after.mate) !== (move.color === 'w' ? 1 : -1));
  if (mateAgainst) return `${move.san} leaves a forced mate against ${move.color === 'w' ? 'White' : 'Black'} in ${Math.abs(after.mate)}. Compare ${bestSan || 'the suggested move'} and the engine continuation.`;
  if (grading.loss < .05) return `${move.san} keeps the evaluation close to the engine’s preferred move${bestSan ? `, ${bestSan}` : ''}.`;
  return `${move.san} costs about ${Math.round(grading.loss * 100)} points of expected score on a 0–100 scale. ${bestSan ? `Try ${bestSan} and explore the suggested line.` : 'Explore the position in analysis to compare alternatives.'}`;
}

function aborted(signal) { if (signal?.aborted) throw new DOMException('Review cancelled.', 'AbortError'); }
function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    aborted(signal);
    const finish = () => { signal?.removeEventListener('abort', cancel); resolve(); };
    const timer = setTimeout(finish, ms);
    const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(new DOMException('Review cancelled.', 'AbortError')); };
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

let searchCaches = new WeakMap();
if (typeof window !== 'undefined') {
  window.addEventListener('chess-engine-configured', () => { searchCaches = new WeakMap(); });
}

async function orderedResults(total, width, signal, evaluate, report) {
  const pending = [];
  let queued = 0;
  for (let index = 0; index < total; index++) {
    aborted(signal);
    // Queue the next request while the native engine works on the current one.
    // Both requests still share the same single Stockfish process.
    while (pending.length < width && queued < total) {
      pending.push(evaluate(queued++).then(value => ({value}), error => ({error})));
    }
    const result = await pending.shift();
    aborted(signal);
    if ('error' in result) throw result.error;
    report(result.value, index);
  }
}

export async function runGameReview(pgn, {signal, ...options} = {}) {
  aborted(signal);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, {once:true});
  try {
    return await evaluateReview(pgn, {...options, signal:controller.signal});
  } finally {
    signal?.removeEventListener('abort', cancel);
    cancel();
  }
}

async function evaluateReview(pgn, {
  signal, onProgress = () => {}, movetime = 50, request = apiFetch, adaptive = request === apiFetch, reuse = false,
  prefetch = request === apiFetch && mobileServer()?.onDevice,
} = {}) {
  const parsed = parseReviewPgn(pgn), board = createRulesGame(parsed.base, parsed.variant), evaluations = [];
  const width = prefetch ? 2 : 1;
  let completedSearches;
  if (reuse) {
    completedSearches = searchCaches.get(request);
    if (!completedSearches) {
      completedSearches = new Map();
      searchCaches.set(request, completedSearches);
    }
  }
  async function search(fen, time, multiPv = 1, rootMove) {
    const options = { fen, variant: parsed.variant, movetime: time, skill: 20, multiPv, purpose: 'review', ...(rootMove && {rootMove}) };
    const key = JSON.stringify(options);
    aborted(signal);
    if (completedSearches?.has(key)) return completedSearches.get(key);
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await request('/api/engine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: key });
      if (response.status === 429 && attempt < 3) { await pause(400 * (attempt + 1), signal); continue; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Stockfish is unavailable. Check your engine connection and retry.');
      if (!data.bestmove || (!Number.isFinite(data.evaluation) && !Number.isFinite(data.mate))) throw new Error('The engine returned an incomplete evaluation. Please retry.');
      if (completedSearches) {
        if (completedSearches.size >= 900) completedSearches.delete(completedSearches.keys().next().value);
        completedSearches.set(key, data);
      }
      return data;
    }
  }
  async function verify(fen, multiPv, needsMore, rootMove) {
    const result = await search(fen, 150, multiPv, rootMove);
    return needsMore(result) ? search(fen, 425, multiPv, rootMove) : result;
  }
  const total = parsed.positions.length;
  aborted(signal);
  onProgress({ phase: 'positions', completed: 0, total, percent: 0 });
  await orderedResults(total, width, signal, async index => {
    aborted(signal);
    if (index) board.move(parsed.moves[index - 1]);
    if (board.isGameOver()) {
      const mate = board.isCheckmate();
      return { evaluation: mate ? null : 0, mate: mate ? 0 : null, winner: mate ? (board.turn() === 'w' ? 'b' : 'w') : null, bestmove: null, depth: 0, lines: [] };
    }
    return search(board.fen(), movetime);
  }, (result, index) => {
    evaluations.push(result);
    onProgress({ phase: 'positions', completed: index + 1, total, percent: Math.round(75 * (index + 1) / total) });
  });
  const counts = { w: Object.fromEntries(REVIEW_CLASSES.map(c => [c, 0])), b: Object.fromEntries(REVIEW_CLASSES.map(c => [c, 0])) };
  const replay = createRulesGame(parsed.base, parsed.variant);
  const moves = [];
  const refinements = [];
  const moveCount = parsed.moves.length;
  onProgress({ phase: 'moves', completed: 0, total: moveCount, percent: 75 });
  await orderedResults(moveCount, width, signal, async index => {
    aborted(signal);
    const move = parsed.moves[index];
    const legalCount = replay.moves().length;
    replay.move(move);
    const ending = resultExplanation(move, replay);
    let beforeEval = evaluations[index], afterEval = evaluations[index + 1];
    const evidence = {};
    if (adaptive && legalCount > 1 && beforeEval.bestmove && afterEval.bestmove) {
      const first = expectedScore(beforeEval, move.color), second = expectedScore(afterEval, move.color);
      const loss = first - second;
      const played = moveUci(move);
      const preferred = beforeEval.bestmove === played;
      const nearBest = preferred || loss < .09;
      const possibleGreat = (preferred || loss < .035) && first >= .53 && first < .92;
      const possibleMiss = first >= .76 && second < .68;
      const borderline = !preferred && gradeBoundaries.some(bound => bound >= .05 && Math.abs(loss - bound) < .012);
      const candidate = nearBest && second >= .30 ? sacrificeCapture(move, parsed.variant, replay) : null;
      if (candidate || possibleGreat || possibleMiss || borderline) {
        const refine = candidate ? verify(move.before, 2, result => {
          const [top, alternative] = result.lines ?? [];
          if (!(top?.depth >= 9) || !alternative?.pv?.[0] || !(alternative.depth >= 8) ||
              Math.abs(top.depth - alternative.depth) > 2) return true;
          const alternativeScore = expectedScore({evaluation: alternative.score, mate: alternative.mate}, move.color);
          const score = expectedScore(result, move.color);
          return Math.abs(alternativeScore - .90) < .045 ||
            (Math.abs(score - second - .02) < .022 && result.bestmove !== played);
        }) : search(move.before, possibleMiss || borderline ? 95 : 70, possibleGreat ? 2 : 1);
        refinements[index] = refine;
        beforeEval = await refine;
        const other = beforeEval.lines?.find(line => line.pv?.[0] !== played);
        if (other) evidence.alternative = expectedScore({evaluation: other.score, mate: other.mate}, move.color);
        const best = beforeEval.bestmove === played;
        const start = expectedScore(beforeEval, move.color);
        const capture = candidate && evidence.alternative < .90 ? moveUci(candidate) : null;

        if (capture && best && start >= .70 && start - second < .02 &&
            verifiesContinuation(beforeEval, move.before, [played, capture], parsed.variant)) {
          evidence.sacrifice = true;
        } else {
          // The next move's refined starting position is also this move's end position.
          const checkAfter = !best && (possibleMiss || borderline || !stableGrade(first, start, second));
          const adjacent = capture || checkAfter ? refinements[index + 1] : null;
          if (adjacent) {
            const result = await adjacent;
            if (result.depth >= 12) afterEval = result;
          }
          if (capture) {
            const needsMore = result => {
              const score = expectedScore(result, move.color);
              return !(result.depth >= 9) || Math.abs(score - .40) < .06 ||
                (Math.abs(start - score - .02) < .025 && Math.abs(score - second) > .04);
            };
            if (afterEval === evaluations[index + 1] || needsMore(afterEval))
              afterEval = await verify(move.after, 1, needsMore);
          } else if (checkAfter && afterEval === evaluations[index + 1]) {
            afterEval = await search(move.after, 100);
          }
          const finish = expectedScore(afterEval, move.color);
          if (capture && finish >= .40 && start - finish < .02) {
            const taken = afterEval.bestmove === capture ? afterEval : await verify(move.after, 1, result => {
              const score = expectedScore(result, move.color);
              const sound = score >= .64 && verifiesContinuation(result, move.after, [capture], parsed.variant);
              const unsound = score <= .32 && result.depth >= 12;
              return result.bestmove !== capture || !(sound || unsound);
            }, capture);
            const compensation = expectedScore(taken, move.color);
            if (taken.bestmove === capture && compensation >= .45) {
              if (compensation >= .60 && verifiesContinuation(taken, move.after, [capture], parsed.variant)) {
                evidence.sacrifice = true;
              } else {
                const continuation = createRulesGame(move.after, parsed.variant);
                continuation.move(candidate);
                const reply = continuation.isGameOver() ? null : await search(continuation.fen(), 320);
                evidence.sacrifice = !!reply?.bestmove && expectedScore(reply, move.color) >= .45;
              }
            }
          }
        }
        evidence.missedChance = possibleMiss && !best;
      }
    }
    aborted(signal);
    const grading = classifyMove(move, beforeEval, afterEval, legalCount, evidence);
    const bestLine = sanLine(move.before, beforeEval.lines?.[0]?.pv || [beforeEval.bestmove].filter(Boolean), parsed.variant);
    const bestSan = bestLine[0] || '';
    return { ...move, ...grading, bestmove: beforeEval.bestmove, bestSan, bestLine, beforeEval, afterEval, explanation: ending ?? explanation(move, grading, bestSan, afterEval) };
  }, (move, index) => {
    counts[move.color][move.classification]++;
    moves.push(move);
    onProgress({ phase: 'moves', completed: index + 1, total: moveCount, percent: 75 + Math.round(24 * (index + 1) / moveCount) });
  });
  const accuracy = Object.fromEntries(['w', 'b'].map(color => {
    const own = moves.filter(m => m.color === color);
    // Transparent local estimate, not Chess.com's proprietary CAPS2 algorithm.
    const value = own.length ? own.reduce((sum, m) => sum + 100 * Math.exp(-3 * m.loss), 0) / own.length : null;
    return [color, value === null ? null : Math.round(value * 10) / 10];
  }));
  const report = { ...parsed, version: REVIEW_VERSION, moves, accuracy, counts, evaluations, movetime, createdAt: new Date().toISOString() };
  aborted(signal);
  onProgress({ phase: 'complete', completed: moveCount, total: moveCount, percent: 100 });
  return report;
}
