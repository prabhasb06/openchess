import { Chess } from "chess.js";

const FILES = "abcdefgh";
const OTHER = { w: "b", b: "w" };
const RESULTS = new Set(["1-0", "0-1", "1/2-1/2", "*"]);
const copyRights = (rights) => ({ w: { ...rights.w }, b: { ...rights.b } });
const file = (square) => FILES.indexOf(square[0]);
const home = (color) => (color === "w" ? "1" : "8");
const stripCastle = (fen) => {
  const fields = fen.trim().split(/\s+/);
  fields[2] = "-";
  return fields.join(" ");
};
const castleField = (rights) =>
  ["w", "b"]
    .flatMap((color) =>
      ["k", "q"].flatMap((side) => {
        const square = rights[color][side];
        return square
          ? [color === "w" ? square[0].toUpperCase() : square[0]]
          : [];
      }),
    )
    .join("") || "-";
const withRights = (fen, rights) => {
  const fields = fen.split(" ");
  fields[2] = castleField(rights);
  return fields.join(" ");
};
function path(from, to) {
  const a = file(from),
    b = file(to),
    step = Math.sign(b - a),
    squares = [from];
  if (!step) return squares;
  for (let f = a + step; f !== b + step; f += step)
    squares.push(FILES[f] + from[1]);
  return squares;
}
function pretty(move) {
  return {
    ...move,
    isCapture() {
      return this.flags.includes("c");
    },
    isPromotion() {
      return this.flags.includes("p");
    },
    isEnPassant() {
      return this.flags.includes("e");
    },
    isKingsideCastle() {
      return this.flags.includes("k");
    },
    isQueensideCastle() {
      return this.flags.includes("q");
    },
    isBigPawn() {
      return this.flags.includes("b");
    },
  };
}
function parsePosition(fen) {
  const fields = fen.trim().split(/\s+/);
  if (fields.length !== 6) throw new Error("Chess960 FEN needs six fields.");
  if (
    !/^\d+$/.test(fields[4]) ||
    !/^[1-9]\d*$/.test(fields[5]) ||
    !Number.isSafeInteger(Number(fields[4])) ||
    !Number.isSafeInteger(Number(fields[5]))
  )
    throw new Error("Chess960 FEN move counters must be valid whole numbers.");
  if (!/^(?:-|[KQABCDEFGHkqabcdefgh]+)$/.test(fields[2]))
    throw new Error("Invalid Chess960 castling field.");
  const game = new Chess(stripCastle(fen));
  const kings = Object.fromEntries(
    ["w", "b"].map((color) => [
      color,
      game
        .board()
        .flat()
        .find((p) => p?.color === color && p.type === "k")?.square,
    ]),
  );
  const rights = { w: {}, b: {} };
  for (const letter of fields[2] === "-" ? "" : fields[2]) {
    const color = letter === letter.toUpperCase() ? "w" : "b";
    const king = kings[color],
      upper = letter.toUpperCase();
    if (!king || king[1] !== home(color))
      throw new Error("A castling king must be on its home rank.");
    let square;
    if (upper === "K" || upper === "Q") {
      const rooks = game
        .board()
        .flat()
        .filter(
          (p) =>
            p?.color === color &&
            p.type === "r" &&
            p.square[1] === home(color) &&
            (upper === "K"
              ? file(p.square) > file(king)
              : file(p.square) < file(king)),
        )
        .map((p) => p.square)
        .sort();
      square = upper === "K" ? rooks.at(-1) : rooks[0];
    } else square = letter.toLowerCase() + home(color);
    const rook = square && game.get(square);
    if (!rook || rook.type !== "r" || rook.color !== color || square === king)
      throw new Error(
        "Each Chess960 castling right must name an existing home-rank rook.",
      );
    const side = file(square) > file(king) ? "k" : "q";
    if (rights[color][side])
      throw new Error(
        "Only one castling rook is allowed on either side of the king.",
      );
    rights[color][side] = square;
  }
  return { game, rights, kings };
}

/** Scharnagl indexes 0..959; index518 is the orthodox starting array. */
export function chess960Start(index = Math.floor(Math.random() * 960)) {
  if (!Number.isInteger(index) || index < 0 || index > 959)
    throw new Error("Chess960 index must be from0 to959.");
  const row = Array(8).fill(null);
  let n = index;
  row[2 * (n % 4) + 1] = "B";
  n = Math.floor(n / 4);
  row[2 * (n % 4)] = "B";
  n = Math.floor(n / 4);
  const empty = () => row.flatMap((piece, i) => (piece ? [] : [i]));
  row[empty()[n % 6]] = "Q";
  n = Math.floor(n / 6);
  const choices = [];
  for (let a = 0; a < 4; a++)
    for (let b = a + 1; b < 5; b++) choices.push([a, b]);
  const free = empty();
  for (const knight of choices[n]) row[free[knight]] = "N";
  for (const [i, piece] of empty().map((f, i) => [f, "RKR"[i]])) row[i] = piece;
  const backRank = row.join("");
  const rookFiles = row.flatMap((piece, i) =>
    piece === "R" ? [FILES[i]] : [],
  );
  const rights = rookFiles.slice().reverse().join("");
  const fen = `${backRank.toLowerCase()}/pppppppp/8/8/8/8/PPPPPPPP/${backRank} w ${rights.toUpperCase()}${rights} - 0 1`;
  return { index, backRank, fen };
}
export const chess960Fen = (index) => chess960Start(index).fen;

/**
 * Chess960 rules adapter using only the existing chess.js ordinary-move rules.
 * Castles use unambiguous UCI960 king→rook from/to, with kingTo/rookTo metadata.
 * SAN remains O-O/O-O-O; public FEN uses explicit Shredder rook-file rights.
 * No chess engine, private bot model, or external dependency is included.
 */
export class Chess960 {
  variant = "chess960";
  constructor(fen = chess960Fen(518)) {
    this.load(fen);
  }
  load(fen, { preserveHeaders = false } = {}) {
    const parsed = parsePosition(fen);
    this._game = parsed.game;
    this._rights = parsed.rights;
    this._kings = parsed.kings;
    this._base = this.fen({ forceEnpassantSquare: true });
    this._records = [];
    this._headers = preserveHeaders ? { ...this._headers } : {};
    this._headers.Variant = "Chess960";
    this._headers.SetUp = "1";
    this._headers.FEN = this._base;
    this._counts = new Map([[this._key(), 1]]);
  }
  reset() {
    this.load(chess960Fen(518));
  }
  fen(options) {
    return withRights(this._game.fen(options), this._rights);
  }
  _key() {
    return this.fen().split(" ").slice(0, 4).join(" ");
  }
  turn() {
    return this._game.turn();
  }
  moveNumber() {
    return this._game.moveNumber();
  }
  board() {
    return this._game.board();
  }
  get(square) {
    return this._game.get(square);
  }
  findPiece(piece) {
    return this.board()
      .flat()
      .filter((p) => p?.type === piece.type && p.color === piece.color)
      .map((p) => p.square);
  }
  squareColor(square) {
    return this._game.squareColor(square);
  }
  isAttacked(square, color) {
    return this._game.isAttacked(square, color);
  }
  attackers(square, color) {
    return this._game.attackers(square, color);
  }
  isCheck() {
    return this._game.isCheck();
  }
  inCheck() {
    return this.isCheck();
  }
  isCheckmate() {
    return this.isCheck() && !this.moves().length;
  }
  isStalemate() {
    return !this.isCheck() && !this.moves().length;
  }
  isInsufficientMaterial() {
    return this._game.isInsufficientMaterial();
  }
  isThreefoldRepetition() {
    return (this._counts.get(this._key()) || 0) >= 3;
  }
  isDrawByFiftyMoves() {
    return this._game.isDrawByFiftyMoves();
  }
  isDraw() {
    return (
      this.isDrawByFiftyMoves() ||
      this.isThreefoldRepetition() ||
      this.isInsufficientMaterial() ||
      this.isStalemate()
    );
  }
  isGameOver() {
    return this.isCheckmate() || this.isDraw();
  }
  getCastlingRights(color) {
    return { k: !!this._rights[color]?.k, q: !!this._rights[color]?.q };
  }
  _afterRights(move) {
    const rights = copyRights(this._rights);
    if (move.piece === "k") rights[move.color] = {};
    for (const color of ["w", "b"])
      for (const side of ["k", "q"])
        if (
          rights[color][side] === move.from ||
          rights[color][side] === move.to
        )
          delete rights[color][side];
    return rights;
  }
  _castlePosition(move) {
    const next = new Chess(
      stripCastle(this.fen({ forceEnpassantSquare: true })),
    );
    next.remove(move.from);
    next.remove(move.rookFrom);
    next.put({ type: "k", color: move.color }, move.kingTo);
    next.put({ type: "r", color: move.color }, move.rookTo);
    const fields = next.fen({ forceEnpassantSquare: true }).split(" ");
    fields[1] = OTHER[move.color];
    fields[3] = "-";
    fields[4] = String(Number(this.fen().split(" ")[4]) + 1);
    fields[5] = String(this.moveNumber() + (move.color === "b" ? 1 : 0));
    return fields.join(" ");
  }
  _castles() {
    if (this.isCheck()) return [];
    const color = this.turn(),
      enemy = OTHER[color],
      from = this._kings[color],
      rank = home(color),
      result = [];
    if (this.get(from)?.type !== "k" || this.get(from)?.color !== color)
      return result;
    for (const side of ["k", "q"]) {
      const rookFrom = this._rights[color][side];
      if (
        !rookFrom ||
        this.get(rookFrom)?.type !== "r" ||
        this.get(rookFrom)?.color !== color
      )
        continue;
      const kingTo = (side === "k" ? "g" : "c") + rank,
        rookTo = (side === "k" ? "f" : "d") + rank;
      const kingPath = path(from, kingTo),
        rookPath = path(rookFrom, rookTo);
      if (
        [...kingPath, ...rookPath].some(
          (square) =>
            square !== from && square !== rookFrom && this.get(square),
        )
      )
        continue;
      // Transit attacks use the initial rook occupancy with the king removed.
      // The final attack check uses the rook's final occupancy, catching a rook
      // that was shielding the king and moves away (including stationary king).
      const transit = new Chess(stripCastle(this.fen()));
      transit.remove(from);
      if (
        kingPath
          .slice(0, -1)
          .some((square) => transit.isAttacked(square, enemy))
      )
        continue;
      const final = new Chess(stripCastle(this.fen()));
      final.remove(from);
      final.remove(rookFrom);
      final.put({ type: "r", color }, rookTo);
      if (final.isAttacked(kingTo, enemy)) continue;
      const move = {
        color,
        from,
        to: rookFrom,
        piece: "k",
        flags: side,
        san: side === "k" ? "O-O" : "O-O-O",
        lan: from + rookFrom,
        castle: side,
        kingTo,
        rookFrom,
        rookTo,
        before: this.fen(),
      };
      move.after = withRights(
        this._castlePosition(move),
        this._afterRights(move),
      );
      const after = new Chess(stripCastle(move.after));
      if (after.isCheck()) move.san += after.isCheckmate() ? "#" : "+";
      result.push(pretty(move));
    }
    return result;
  }
  moves({ verbose = false, square, piece } = {}) {
    const castles =
      (!piece || piece === "k") &&
      (!square || square === this._kings[this.turn()])
        ? this._castles()
        : [];
    if (!verbose)
      return [
        ...this._game.moves({
          ...(square ? { square } : {}),
          ...(piece ? { piece } : {}),
        }),
        ...castles.map((move) => move.san),
      ];
    const normal = this._game
      .moves({
        verbose: true,
        ...(square ? { square } : {}),
        ...(piece ? { piece } : {}),
      })
      .map((move) =>
        pretty({
          ...move,
          before: this.fen(),
          after: withRights(move.after, this._afterRights(move)),
        }),
      );
    const moves = [...normal, ...castles];
    return moves;
  }
  move(input, { strict = false } = {}) {
    const moves = this.moves({
      verbose: true,
      ...(input && typeof input === "object" && input.from
        ? { square: input.from }
        : {}),
    });
    let chosen;
    if (typeof input === "string") {
      const token = input.replace(/0/g, "O").replace(/[!?]+$/g, "");
      const relaxed = (san) => san.replace(/[+#]$/, "");
      chosen = moves.find((m) =>
        strict ? m.san === token : relaxed(m.san) === relaxed(token),
      );
      if (!chosen) chosen = moves.find((m) => m.lan === input);
      if (!chosen && !/^O-O/.test(token)) {
        try {
          const ordinary = new Chess(stripCastle(this.fen())).move(input, {
            strict,
          });
          chosen = moves.find(
            (m) =>
              !m.castle &&
              m.from === ordinary.from &&
              m.to === ordinary.to &&
              m.promotion === ordinary.promotion,
          );
        } catch {
          /* Report one consistent invalid-move error below. */
        }
      }
    } else if (input && typeof input === "object") {
      chosen = moves.find(
        (m) =>
          m.from === input.from &&
          m.to === input.to &&
          (!m.promotion || m.promotion === input.promotion) &&
          (!input.castle || m.castle === input.castle),
      );
    }
    if (!chosen)
      throw new Error(`Invalid Chess960 move: ${JSON.stringify(input)}`);
    const beforeRaw = this.fen({ forceEnpassantSquare: true });
    const rights = this._afterRights(chosen);
    if (chosen.castle) this._game = new Chess(this._castlePosition(chosen));
    else
      this._game.move({
        from: chosen.from,
        to: chosen.to,
        promotion: chosen.promotion,
      });
    this._rights = rights;
    const made = { ...chosen, after: this.fen() };
    this._records.push({ move: made, beforeRaw });
    const key = this._key();
    this._counts.set(key, (this._counts.get(key) || 0) + 1);
    return pretty(made);
  }
  undo() {
    const record = this._records.pop();
    if (!record) return null;
    const key = this._key(),
      count = this._counts.get(key) || 0;
    if (count > 1) this._counts.set(key, count - 1);
    else this._counts.delete(key);
    const restored = parsePosition(record.beforeRaw);
    this._game = restored.game;
    this._rights = restored.rights;
    this._kings = restored.kings;
    return pretty(record.move);
  }
  history({ verbose = false } = {}) {
    return this._records.map(({ move }) => (verbose ? pretty(move) : move.san));
  }
  getHeaders() {
    return {
      ...this._headers,
      Variant: "Chess960",
      SetUp: "1",
      FEN: this._base,
    };
  }
  setHeader(key, value) {
    let equivalentFen = value === this._base;
    if (key === "FEN" && !equivalentFen) {
      const parsed = parsePosition(value);
      equivalentFen =
        withRights(
          parsed.game.fen({ forceEnpassantSquare: true }),
          parsed.rights,
        ) === this._base;
    }
    if (
      (key === "Variant" &&
        !/^(Chess960|Fischerandom|FischerRandom)$/i.test(value)) ||
      (key === "FEN" && !equivalentFen) ||
      (key === "SetUp" && value !== "1")
    )
      throw new Error(
        "Chess960 structural PGN tags must describe the current starting position.",
      );
    this._headers[key] = key === "FEN" ? this._base : String(value);
    return this.getHeaders();
  }
  header(...pairs) {
    for (let i = 0; i + 1 < pairs.length; i += 2)
      this.setHeader(pairs[i], pairs[i + 1]);
    return this.getHeaders();
  }
  removeHeader(key) {
    if (["Variant", "SetUp", "FEN"].includes(key)) return false;
    return delete this._headers[key];
  }
  pgn({ newline = "\n", maxWidth = 0 } = {}) {
    const escape = (value) =>
      String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const headers = Object.entries(this.getHeaders())
      .map(([key, value]) => `[${key} "${escape(value)}"]`)
      .join(newline);
    const tokens = [];
    for (const [i, { move }] of this._records.entries()) {
      const fields = move.before.split(" ");
      if (move.color === "w") tokens.push(fields[5] + ".");
      else if (!i) tokens.push(fields[5] + "...");
      tokens.push(move.san);
    }
    tokens.push(RESULTS.has(this._headers.Result) ? this._headers.Result : "*");
    const lines = [""];
    for (const token of tokens) {
      const last = lines.at(-1);
      if (maxWidth > 0 && last && last.length + token.length + 1 > maxWidth)
        lines.push(token);
      else lines[lines.length - 1] += (last ? " " : "") + token;
    }
    return headers + newline + newline + lines.join(newline);
  }
  loadPgn(pgn, { strict = false } = {}) {
    const headers = {};
    const source = String(pgn).replace(/^\uFEFF/, "");
    const tag = /\[\s*([A-Za-z0-9_]+)\s+"((?:\\.|[^"\\])*)"\s*\]/y;
    let cursor = 0;
    while (cursor < source.length) {
      while (/\s/.test(source[cursor] || "") && cursor < source.length)
        cursor++;
      if (source[cursor] !== "[") break;
      tag.lastIndex = cursor;
      const match = tag.exec(source);
      if (!match) throw new Error("Invalid PGN header.");
      const [, rawKey, value] = match;
      const key = ["FEN","Variant","SetUp","Result"].find(name=>name.toLowerCase()===rawKey.toLowerCase()) || rawKey;
      if (Object.hasOwn(headers, key))
        throw new Error("Duplicate PGN header or multiple games.");
      headers[key] = value.replace(/\\(.)/g, "$1");
      cursor = tag.lastIndex;
    }
    let body = source.slice(cursor);
    if (
      headers.Variant &&
      !/^(Chess960|Fischerandom|FischerRandom)$/i.test(headers.Variant)
    )
      throw new Error("This PGN is not Chess960.");
    let depth = 0,
      comment = false,
      lineComment = false,
      mainline = "";
    for (const character of body) {
      if (lineComment) {
        if (character === "\n" || character === "\r") {
          lineComment = false;
          mainline += " ";
        }
        continue;
      }
      if (comment) {
        if (character === "}") {
          comment = false;
          mainline += " ";
        }
        continue;
      }
      if (character === ";") {
        lineComment = true;
        mainline += " ";
        continue;
      }
      if (character === "{") {
        comment = true;
        mainline += " ";
        continue;
      }
      if (character === "(") {
        depth++;
        if (depth === 1) mainline += " ";
        continue;
      }
      if (character === ")") {
        if (!depth) throw new Error("Unbalanced PGN variation.");
        depth--;
        if (!depth) mainline += " ";
        continue;
      }
      if (!depth) mainline += character;
    }
    if (depth || comment) throw new Error("Unclosed PGN comment or variation.");
    body = mainline
      .replace(/\$\d+/g, " ")
      .replace(/\d+\.(?:\s*\.{2,3})?|\.\.\./g, " ");
    const tokens = body.trim().split(/\s+/).filter(Boolean);
    const next = new Chess960(headers.FEN || chess960Fen(518));
    let result = "*",
      finished = false;
    for (const token of tokens) {
      if (finished) throw new Error("Unexpected tokens after PGN result.");
      if (RESULTS.has(token)) {
        result = token;
        finished = true;
      } else next.move(token, { strict });
    }
    for (const [key, value] of Object.entries(headers))
      next.setHeader(key, value);
    if (finished) next.setHeader("Result", result);
    this._game = next._game;
    this._rights = next._rights;
    this._kings = next._kings;
    this._base = next._base;
    this._records = next._records;
    this._headers = next._headers;
    this._counts = next._counts;
  }
  perft(depth) {
    if (!Number.isInteger(depth) || depth < 0)
      throw new Error("Invalid perft depth.");
    if (!depth) return 1;
    if (depth === 1) return this.moves().length;
    let nodes = 0;
    for (const move of this.moves({ verbose: true })) {
      this.move(move);
      nodes += this.perft(depth - 1);
      this.undo();
    }
    return nodes;
  }
  ascii() {
    return this._game.ascii();
  }
}

/** Variant-aware counterpart of gameplay.validatePosition, without mutation. */
export function validateChess960Position(fen) {
  const game = new Chess960(fen),
    pieces = game.board().flat().filter(Boolean);
  const white = pieces.find((p) => p.color === "w" && p.type === "k"),
    black = pieces.find((p) => p.color === "b" && p.type === "k");
  if (
    Math.abs(file(white.square) - file(black.square)) <= 1 &&
    Math.abs(Number(white.square[1]) - Number(black.square[1])) <= 1
  )
    throw new Error("Place the two kings on non-adjacent squares.");
  if (pieces.some((p) => p.type === "p" && /[18]/.test(p.square[1])))
    throw new Error("Pawns cannot stand on the first or eighth rank.");
  const waiting = game.turn() === "w" ? black : white;
  if (game.isAttacked(waiting.square, game.turn()))
    throw new Error("The side that just moved cannot leave its king in check.");
  for (const color of ["w", "b"]) {
    const own = pieces.filter((piece) => piece.color === color);
    if (own.length > 16 || own.filter((piece) => piece.type === "p").length > 8)
      throw new Error(
        "A side can have at most sixteen pieces and eight pawns.",
      );
  }
  const fields = fen.trim().split(/\s+/);
  if (fields[3] !== "-") {
    const f = fields[3][0],
      turn = fields[1];
    const advanced = game.get(f + (turn === "w" ? "5" : "4"));
    if (
      game.get(fields[3]) ||
      !advanced ||
      advanced.type !== "p" ||
      advanced.color === turn ||
      game.get(f + (turn === "w" ? "7" : "2")) ||
      Number(fields[4]) !== 0
    )
      throw new Error(
        "An en passant square needs an opposing pawn that just advanced two squares.",
      );
  }
  return game;
}
