import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Chess960, chess960Fen } from "../src/chess960.js";
import { createRulesGame } from "../src/chess-rules.js";
import { analyzePosition, createAppServer, validateSearch, stockfishPath } from "../server.mjs";
import { parseReviewPgn, runGameReview } from "../src/review-model.js";
import { selectMoveSound } from "../src/audio.js";

const uciMove = (value) => ({from:value.slice(0,2),to:value.slice(2,4),promotion:value[4]});
function castleGame(fen, moves) {
  const game = new Chess960(fen);
  game.setHeader("White", "Local White");game.setHeader("Black", "Local Black");
  game.setHeader("Result", "*");
  for (const san of moves) game.move(san);
  return game;
}
const stationary = () => castleGame("k7/8/8/8/8/8/8/6KR w H - 0 1", ["O-O", "Kb7", "Rf7+", "Kc6"]);

test("engine endpoint requires an explicit supported variant and validates Chess960 rights", () => {
  const fen=chess960Fen(42);
  assert.throws(()=>validateSearch({fen}));
  for(const variant of ["atomic", "Chess960", null, false, 960, {}]) assert.throws(()=>validateSearch({fen,variant}),/variant/);
  const search=validateSearch({fen,variant:"chess960",movetime:50});
  assert.equal(search.variant,"chess960");assert.equal(search.fen,fen);
  assert.throws(()=>validateSearch({fen:"k7/8/8/8/8/8/8/6KR w A - 0 1",variant:"chess960"}));
  assert.throws(()=>validateSearch({fen:fen+"\nquit",variant:"chess960"}));
  assert.equal(validateSearch({fen:chess960Fen(518).replace("HAha","KQkq"),variant:"standard"}).variant,"standard");
});

test("existing Stockfish returns legal canonical UCI960 moves and complete replayable PVs across nonstandard arrays", async () => {
  for(const index of [0,42,518,959]) {
    const fen=chess960Fen(index), result=await analyzePosition({fen,variant:"chess960",movetime:100,multiPv:3,skill:20});
    assert.equal(result.variant,"chess960");assert.equal(result.lines.length,3);assert(result.depth>0);
    assert(new Chess960(fen).move(uciMove(result.bestmove)));
    for(const line of result.lines){const game=new Chess960(fen);for(const move of line.pv)assert(game.move(uciMove(move)));}
  }
});

test("Chess960 reviews preserve castle metadata and variant when all castling rights disappear", () => {
  for(const [fen,moves,from,to,kingTo,rookTo] of [
    ["k7/8/8/8/8/8/8/6KR w H - 0 1",["O-O","Kb7"],"g1","h1","g1","f1"],
    ["k7/8/8/8/8/8/8/4KR2 w F - 0 1",["O-O","Kb7"],"e1","f1","g1","f1"],
    ["7k/8/8/8/8/8/8/2RK4 w C - 0 1",["O-O-O","Kh7"],"d1","c1","c1","d1"],
  ]) {
    const source=castleGame(fen,moves), parsed=parseReviewPgn(source.pgn()), move=parsed.moves[0];
    assert.equal(parsed.variant,"chess960");assert.equal(move.from,from);assert.equal(move.to,to);assert.equal(move.kingTo,kingTo);assert.equal(move.rookTo,rookTo);
    assert.equal(selectMoveSound(move),"castle");
    assert.equal(move.after.split(" ")[2],"-");assert.equal(createRulesGame(move.after,parsed.variant).variant,"chess960");
    assert.equal(parsed.pgn,source.pgn());assert.match(move.san,/^O-O/);
  }
});

test("review requests and SAN suggestions keep UCI960 king-to-rook semantics", async () => {
  const pgn=stationary().pgn(), requests=[];
  const report=await runGameReview(pgn,{request:async(_,options)=>{
    const input=JSON.parse(options.body);requests.push(input);const board=createRulesGame(input.fen,input.variant);
    const selected=board.moves({verbose:true}).find(m=>m.castle)||board.moves({verbose:true})[0];
    const bestmove=selected.from+selected.to+(selected.promotion||"");
    return {ok:true,status:200,json:async()=>({bestmove,evaluation:.1,mate:null,depth:1,lines:[{pv:[bestmove]}]})};
  }});
  assert(requests.every(r=>r.variant==="chess960"));assert.equal(requests.at(-1).fen.split(" ")[2],"-");
  assert.equal(report.moves[0].bestmove,"g1h1");assert.equal(report.moves[0].bestSan,"O-O");assert.deepEqual(report.moves[0].bestLine,["O-O"]);
  assert.equal(report.moves[0].classification,"Best");assert.equal(report.variant,"chess960");assert.equal(report.pgn,pgn);
});

test("real Stockfish reviews a castled Chess960 game with legal continuations and correct original history", async () => {
  const original=stationary().pgn(), progress=[];
  const report=await runGameReview(original,{movetime:50,onProgress:value=>progress.push(value),request:async(_,options)=>({ok:true,status:200,json:()=>analyzePosition(JSON.parse(options.body),options.signal)})});
  assert.equal(report.variant,"chess960");assert.equal(report.pgn,original);assert.equal(report.moves.length,4);assert.equal(progress.at(-1).completed,5);
  assert.equal(report.moves[0].castle,"k");assert.equal(report.moves[0].to,"h1");
  for(const move of report.moves){const board=createRulesGame(move.before,report.variant);for(const san of move.bestLine)assert(board.move(san));}
  assert.equal(Object.values(report.counts.w).reduce((a,b)=>a+b,0),2);assert.equal(Object.values(report.counts.b).reduce((a,b)=>a+b,0),2);
});

test("variant repetition uses history and does not search the terminal draw position", async () => {
  const game=new Chess960(chess960Fen(518));for(const san of ["Nf3","Nf6","Ng1","Ng8","Nf3","Nf6","Ng1","Ng8"])game.move(san);
  const requests=[];const report=await runGameReview(game.pgn(),{request:async(_,options)=>{const input=JSON.parse(options.body);requests.push(input);const move=createRulesGame(input.fen,input.variant).moves({verbose:true})[0];return{ok:true,status:200,json:async()=>({bestmove:move.from+move.to+(move.promotion||""),evaluation:0,lines:[]})};}});
  assert.equal(requests.length,8);assert.equal(report.moves.at(-1).afterEval.evaluation,0);assert.match(report.moves.at(-1).explanation,/repetition/);
});

test("HTTP variant requests reject mismatches, run the original engine, and leave its bytes unchanged", async () => {
  const before=createHash("sha256").update(await readFile(stockfishPath)).digest("hex");
  const server=createAppServer();await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const url=`http://127.0.0.1:${server.address().port}/api/engine`;
  const send=body=>fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  try{
    assert.equal((await send({fen:chess960Fen(0)})).status,400);
    assert.equal((await send({fen:chess960Fen(0),variant:"unknown"})).status,400);
    const res=await send({fen:chess960Fen(0),variant:"chess960",movetime:50});assert.equal(res.status,200);const data=await res.json();assert.equal(data.variant,"chess960");assert(new Chess960(chess960Fen(0)).move(uciMove(data.bestmove)));
  }finally{await new Promise(resolve=>server.close(resolve));}
  assert.equal(createHash("sha256").update(await readFile(stockfishPath)).digest("hex"),before);
});
