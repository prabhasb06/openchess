import { createRulesGame, readRulesPgn } from './chess-rules.js';
import { apiFetch } from './mobile-api.js';

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

export function sacrificeCapture(move, variant) {
  if (move.castle || move.promotion || pieceValue[move.piece] < 3) return null;
  const reply = createRulesGame(move.after, variant).moves({ verbose: true })
    .find(candidate => candidate.to === move.to && candidate.captured === move.piece);
  return reply && pieceValue[move.piece] - (pieceValue[move.captured] || 0) >= 2 ? reply : null;
}

function sanLine(fen, pv, variant) {
  const board = createRulesGame(fen, variant), out = [];
  for (const uci of (pv || []).slice(0, 10)) {
    try { out.push(board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san); }
    catch { break; }
  }
  return out;
}

function explanation(move, grading, bestSan, after, board) {
  if (board.isCheckmate()) return `${move.san} delivers checkmate.`;
  if (board.isDraw()) return `${move.san} reaches a drawn position${board.isStalemate() ? ' by stalemate' : board.isThreefoldRepetition() ? ' by repetition' : board.isInsufficientMaterial() ? ' with insufficient material' : ''}.`;
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

const completedSearches = new Map();

export async function runGameReview(pgn, {
  signal, onProgress = () => {}, movetime = 65, request = apiFetch, adaptive = request === apiFetch, reuse = false,
} = {}) {
  const parsed = parseReviewPgn(pgn), board = createRulesGame(parsed.base, parsed.variant), evaluations = [];
  async function search(fen, time, multiPv = 1, rootMove) {
    const options = { fen, variant: parsed.variant, movetime: time, skill: 20, multiPv, purpose: 'review', ...(rootMove && {rootMove}) };
    const key = JSON.stringify(options);
    aborted(signal);
    if (reuse && completedSearches.has(key)) return completedSearches.get(key);
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await request('/api/engine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: key });
      if (response.status === 429 && attempt < 3) { await pause(400 * (attempt + 1), signal); continue; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Stockfish is unavailable. Check your engine connection and retry.');
      if (!data.bestmove || (!Number.isFinite(data.evaluation) && !Number.isFinite(data.mate))) throw new Error('The engine returned an incomplete evaluation. Please retry.');
      if (reuse) {
        if (completedSearches.size >= 900) completedSearches.delete(completedSearches.keys().next().value);
        completedSearches.set(key, data);
      }
      return data;
    }
  }
  const total = parsed.positions.length;
  onProgress({ completed: 0, total });
  for (let index = 0; index < total; index++) {
    aborted(signal);
    if (index) board.move(parsed.moves[index - 1]);
    let result;
    if (board.isGameOver()) {
      result = { evaluation: board.isCheckmate() ? null : 0, mate: board.isCheckmate() ? 0 : null, winner: board.isCheckmate() ? (board.turn() === 'w' ? 'b' : 'w') : null, bestmove: null, depth: 0, lines: [] };
    } else result = await search(board.fen(), movetime);
    aborted(signal);
    evaluations.push(result);
    onProgress({ completed: index + 1, total });
  }
  const counts = { w: Object.fromEntries(REVIEW_CLASSES.map(c => [c, 0])), b: Object.fromEntries(REVIEW_CLASSES.map(c => [c, 0])) };
  const replay = createRulesGame(parsed.base, parsed.variant);
  const moves = [];
  for (const [index, move] of parsed.moves.entries()) {
    const legalCount = replay.moves().length;
    replay.move(move);
    let beforeEval = evaluations[index], afterEval = evaluations[index + 1];
    const evidence = {};
    if (adaptive && legalCount > 1 && beforeEval.bestmove && afterEval.bestmove) {
      const first = expectedScore(beforeEval, move.color), second = expectedScore(afterEval, move.color);
      const candidate = sacrificeCapture(move, parsed.variant);
      const loss = first - second;
      const nearBest = beforeEval.bestmove === moveUci(move) || loss < .09;
      const possibleGreat = nearBest && first >= .53 && first < .92;
      const possibleMiss = first >= .76 && second < .68;
      const borderline = [.05, .10, .20].some(bound => Math.abs(loss - bound) < .012);
      const checkSacrifice = candidate && nearBest && second >= .30;
      if (checkSacrifice || possibleGreat || possibleMiss || borderline) {
        beforeEval = await search(move.before, checkSacrifice ? 425 : 105, 2);
        const other = beforeEval.lines?.find(line => line.pv?.[0] !== moveUci(move));
        if (other) evidence.alternative = expectedScore({evaluation: other.score, mate: other.mate}, move.color);
        if (beforeEval.bestmove !== moveUci(move) || checkSacrifice)
          afterEval = await search(move.after, checkSacrifice ? 425 : 100);
        evidence.missedChance = possibleMiss && beforeEval.bestmove !== moveUci(move);
        if (checkSacrifice && other && expectedScore(beforeEval, move.color) - expectedScore(afterEval, move.color) < .02) {
          const taken = await search(move.after, 425, 1, moveUci(candidate));
          if (taken.bestmove === moveUci(candidate) && expectedScore(taken, move.color) >= .45) {
            const continuation = createRulesGame(move.after, parsed.variant);
            continuation.move(candidate);
            const reply = continuation.isGameOver() ? null : await search(continuation.fen(), 320);
            evidence.sacrifice = !!reply?.bestmove && expectedScore(reply, move.color) >= .45;
          }
        }
      }
    }
    const grading = classifyMove(move, beforeEval, afterEval, legalCount, evidence);
    const bestLine = sanLine(move.before, beforeEval.lines?.[0]?.pv || [beforeEval.bestmove].filter(Boolean), parsed.variant);
    const bestSan = bestLine[0] || '';
    counts[move.color][grading.classification]++;
    moves.push({ ...move, ...grading, bestmove: beforeEval.bestmove, bestSan, bestLine, beforeEval, afterEval, explanation: explanation(move, grading, bestSan, afterEval, replay) });
  }
  const accuracy = Object.fromEntries(['w', 'b'].map(color => {
    const own = moves.filter(m => m.color === color);
    // Transparent local estimate, not Chess.com's proprietary CAPS2 algorithm.
    const value = own.length ? own.reduce((sum, m) => sum + 100 * Math.exp(-3 * m.loss), 0) / own.length : null;
    return [color, value === null ? null : Math.round(value * 10) / 10];
  }));
  return { ...parsed, version: REVIEW_VERSION, moves, accuracy, counts, evaluations, movetime, createdAt: new Date().toISOString() };
}
