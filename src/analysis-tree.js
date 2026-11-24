import { Chess } from "chess.js";
// The installed, locked chess.js1.4 distribution ships its Peggy PGN grammar.
// Its public Chess.loadPgn intentionally visits only the first variation.
// Reuse the same parser and validate every branch with Chess instead.
import { parse } from "../node_modules/chess.js/src/pgn.js";
import { createRulesGame, validateRulesPosition, variantForFen, normalizePgnHeaders } from "./chess-rules.js";

const START = new Chess().fen();
const objectMove = (move) => typeof move === "string"
  ? { from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] }
  : { from: move.from, to: move.to, promotion: move.promotion };
const uci = (move) => move.from + move.to + (move.promotion || "");
const comment = (text) => `{${String(text).replace(/[{}]/g, "").replace(/\r/g, "")}}`;
const tag = (text) => String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]/g, " ");

/** Immutable-node analysis tree. Canonical child0 remains the mainline until
 * the user explicitly promotes another line. Merely exploring never erases it.
 * This is local PGN behavior; native Android tree geometry is not yet captured.
 */
export class AnalysisTree {
  constructor({ fen = START, pgn, headers = {}, variant } = {}) {
    let parsed;
    if (pgn != null) {
      if (typeof pgn !== "string" || pgn.length > 200000) throw new Error("Choose a PGN smaller than 200 KB.");
      try { parsed = parse(pgn); } catch { throw new Error("The PGN could not be read. Check its moves and variation parentheses."); }
      headers = normalizePgnHeaders(parsed.headers);
      fen = Object.entries(headers).find(([key]) => key.toLowerCase() === "fen")?.[1] || START;
    }
    this.variant = variantForFen(fen, headers.Variant || variant);
    this.base = validateRulesPosition(fen, this.variant).fen();
    this.headers = { ...headers, Result: parsed?.result || headers.Result || "*" };
    if (this.base !== START) { this.headers.SetUp = "1"; this.headers.FEN = this.base; }
    else { delete this.headers.SetUp; delete this.headers.FEN; }
    if (this.variant === "chess960") { this.headers.Variant = "Chess960"; this.headers.SetUp = "1"; this.headers.FEN = this.base; }
    this.nodes = { root: { id: "root", parent: null, children: [], fen: this.base, comment: parsed?.root.comment || "" } };
    this.selected = {};
    this.next = 1;
    if (parsed) this.importNodes("root", parsed.root.variations, 0);
  }
  importNodes(parent, nodes, depth, startingComment = "") {
    if (depth > 512 || this.next > 10000) throw new Error("This PGN has too many moves or nested variations.");
    for (const source of nodes || []) {
      if (!source.move) { this.importNodes(parent, source.variations, depth + 1, [startingComment, source.comment].filter(Boolean).join(" ")); continue; }
      const board = createRulesGame(this.nodes[parent].fen, this.variant);
      let move;
      try { move = board.move(source.move); } catch { throw new Error(`Illegal PGN move or variation: ${source.move}.`); }
      const id = this.insert(parent, move, {
        comment: source.comment || "", startingComment,
        suffix: (source.suffix || []).join(""),
        nags: (source.nag || []).map(Number).filter(Number.isSafeInteger),
      });
      this.importNodes(id, source.variations, depth + 1);
    }
  }
  insert(parent, move, notes = {}) {
    const id = "n" + this.next++;
    this.nodes = { ...this.nodes,
      [parent]: { ...this.nodes[parent], children: [...this.nodes[parent].children, id] },
      [id]: { id, parent, children: [], uci: uci(move), san: move.san,
        fen: move.after, before: move.before, comment: "", startingComment: "", suffix: "", nags: [], ...notes },
    };
    return id;
  }
  pathTo(id) {
    const path = [];
    for (let node = this.nodes[id]; node?.parent; node = this.nodes[node.parent]) path.unshift(node.id);
    if (id !== "root" && (!this.nodes[id] || !path.length)) throw new Error("That variation no longer exists.");
    return path;
  }
  line({ main = false } = {}) {
    const path = [];
    for (let node = this.nodes.root; node?.children.length;) {
      const selected = !main && this.selected[node.id];
      const id = selected && node.children.includes(selected) ? selected : node.children[0];
      path.push(id); node = this.nodes[id];
    }
    return path;
  }
  select(id) {
    let parent = "root";
    const selected = { ...this.selected };
    for (const child of this.pathTo(id)) { selected[parent] = child; parent = child; }
    this.selected = selected;
    return this.pathTo(id).length;
  }
  selectPath(moves) {
    let parent = "root";
    for (const move of moves || []) {
      const id = this.nodes[parent].children.find((child) => this.nodes[child].uci === move);
      if (!id) break;
      this.select(id); parent = id;
    }
    return this.pathTo(parent).length;
  }
  board(path = this.line()) {
    const board = createRulesGame(this.base, this.variant);
    for (const id of path) board.move(objectMove(this.nodes[id].uci));
    for (const [key, value] of Object.entries(this.headers)) board.setHeader(key, value);
    if (path.join() !== this.line({ main: true }).join()) board.setHeader("Result", "*");
    return board;
  }
  add(parent, move) {
    if (!this.nodes[parent]) throw new Error("That position no longer exists.");
    const board = createRulesGame(this.nodes[parent].fen, this.variant);
    const made = board.move(objectMove(move));
    let id = this.nodes[parent].children.find((child) => this.nodes[child].uci === uci(made));
    if (!id) id = this.insert(parent, made);
    this.select(id);
    return { id, move: made, ply: this.pathTo(id).length };
  }
  addContinuation(parent, moves) {
    if (!Array.isArray(moves) || moves.length > 600) throw new Error("The continuation is too long.");
    const board = createRulesGame(this.nodes[parent]?.fen, this.variant);
    const validated = moves.map(move => board.move(typeof move === "string" && !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move) ? move : objectMove(move)));
    let id = parent;
    for (const made of validated) id = this.add(id, made).id;
    this.select(id);
    return {id, ply:this.pathTo(id).length};
  }
  promote(id) {
    const path = this.pathTo(id);
    if (!path.length) return;
    let changed = false;
    for (const child of path) {
      const parent = this.nodes[child].parent, node = this.nodes[parent];
      if (node.children[0] !== child) {
        changed = true;
        this.nodes = { ...this.nodes, [parent]: { ...node, children: [child, ...node.children.filter((s) => s !== child)] } };
      }
    }
    if (changed) this.headers = { ...this.headers, Result: "*" };
    this.select(id);
  }
  remove(id) {
    if (id === "root" || !this.nodes[id]) return false;
    const parent = this.nodes[id].parent;
    const pending = [id], nodes = { ...this.nodes }, selected = { ...this.selected };
    while (pending.length) { const current = pending.pop(); pending.push(...nodes[current].children); delete nodes[current]; delete selected[current]; }
    const node = nodes[parent];
    if (node.children[0] === id) this.headers = { ...this.headers, Result: "*" };
    nodes[parent] = { ...node, children: node.children.filter((child) => child !== id) };
    if (selected[parent] === id) delete selected[parent];
    this.nodes = nodes; this.selected = selected; this.select(parent);
    return parent;
  }
  annotate(id, { text, nag } = {}) {
    const node = this.nodes[id];
    if (!node) return false;
    if (text !== undefined && (typeof text !== "string" || text.length > 10000)) throw new Error("Keep comments under 10,000 characters.");
    if (nag !== undefined && (!Number.isInteger(nag) || nag < 0 || nag > 255)) throw new Error("Invalid move annotation.");
    this.nodes = { ...this.nodes, [id]: { ...node,
      ...(text !== undefined ? { comment: text } : {}),
      ...(nag !== undefined ? { nags: nag ? [nag] : [], suffix: "" } : {}),
    } };
    return true;
  }
  pgn() {
    const writeMove = (id) => {
      const node = this.nodes[id], fields = node.before.split(" ");
      return [node.startingComment ? comment(node.startingComment) : "", `${fields[5]}${fields[1] === "w" ? "." : "..."}`, node.san + node.suffix,
        ...node.nags.map(n => "$" + n), node.comment ? comment(node.comment) : ""].filter(Boolean).join(" ");
    };
    const writeLine = (first, variation = false) => {
      const parts = [];
      let id = first, skipSiblings = variation;
      while (id) {
        parts.push(writeMove(id));
        if (!skipSiblings) for (const sibling of this.nodes[this.nodes[id].parent].children.slice(1)) parts.push("(" + writeLine(sibling, true) + ")");
        skipSiblings = false;
        id = this.nodes[id].children[0];
      }
      return parts.join(" ");
    };
    return Object.entries(this.headers).map(([key, value]) => `[${key} "${tag(value)}"]`).join("\n") + "\n\n" +
      [this.nodes.root.comment ? comment(this.nodes.root.comment) : "", this.nodes.root.children.length ? writeLine(this.nodes.root.children[0]) : "", this.headers.Result || "*"].filter(Boolean).join(" ");
  }
  snapshot(ply) {
    const path = this.line();
    return { base: this.base, variant: this.variant, nodes: this.nodes, path, cursor: path[ply - 1] || "root",
      mainPath: this.line({ main: true }), selected: this.selected,
      variations: Object.values(this.nodes).reduce((sum, node) => sum + Math.max(0, node.children.length - 1), 0),
    };
  }
}
