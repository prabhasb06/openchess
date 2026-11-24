import React, { useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  Eraser,
  FlipVertical2,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { localBoard, localPiece } from "./local-art";
import { copyMobileText } from "../mobile-api";
import {
  START_POSITION,
  positionDraft,
  draftFen,
  validateEditorPosition,
} from "./position-editor-model";
import "./position-editor.css";
import {chess960Fen} from "../chess960";

const names = {
  k: "king",
  q: "queen",
  r: "rook",
  b: "bishop",
  n: "knight",
  p: "pawn",
};
const label = (piece) =>
  `${piece[0] === "w" ? "White" : "Black"} ${names[piece[1]]}`;

// Local setup layout; the installed Android position-editor geometry remains unobserved.
export function MobilePositionEditor({
  prefs = {},
  onLoad,
  onClose,
  initialFen = START_POSITION,
  initialVariant,
}) {
  const [draft, setDraft] = useState(() => {
    try {
      return positionDraft(initialFen, initialVariant);
    } catch {
      return positionDraft();
    }
  });
  const [brush, setBrush] = useState("wq"),
    [flipped, setFlipped] = useState(false);
  const [input, setInput] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const fen = useMemo(() => draftFen(draft), [draft]);
  const colors = localBoard(prefs.mobileBoard);
  const files = flipped ? "hgfedcba" : "abcdefgh",
    ranks = flipped ? "12345678" : "87654321";
  const squares = [...ranks].flatMap((r) => [...files].map((f) => f + r));
  const castleChoices = draft.variant === "chess960"
    ? ["w","b"].flatMap(color => {
      const rank = color === "w" ? "1" : "8";
      const king = [..."abcdefgh"].find(file=>draft.pieces[file+rank]===color+"k");
      return king ? [..."abcdefgh"].filter(file=>draft.pieces[file+rank]===color+"r").map(file=>[color==="w"?file.toUpperCase():file,`${color==="w"?"White":"Black"} rook ${file+rank}`]) : [];
    })
    : [["K","White kingside"],["Q","White queenside"],["k","Black kingside"],["q","Black queenside"]];
  const sourceFor = (piece) => localPiece(piece, prefs.mobilePieces);
  function update(change) {
    setDraft((old) => ({ ...old, ...change }));
    setError("");
    setMessage("");
  }
  function place(square, piece = brush) {
    const pieces = { ...draft.pieces };
    if (!piece || pieces[square] === piece) delete pieces[square];
    else pieces[square] = piece;
    update({ pieces });
  }
  function loadFen() {
    try {
      const valid = validateEditorPosition(input.trim(), draft.variant);
      setDraft(positionDraft(valid, draft.variant));
      setError("");
      setMessage("Position loaded.");
      setInput("");
    } catch (e) {
      setError(e.message);
      setMessage("");
    }
  }
  function analyze() {
    try {
      const valid = validateEditorPosition(fen, draft.variant);
      setError("");
      onLoad(valid, draft.variant);
    } catch (e) {
      setError(e.message);
      setMessage("");
    }
  }
  return (
    <section className="am-position-editor" aria-label="Set up position">
      <header className="am-editor-header">
        <button
          type="button"
          aria-label="Back from position editor"
          onClick={onClose}
        >
          <ArrowLeft />
        </button>
        <h1>Set Up Position</h1>
        <button type="button" aria-label="Analyze position" onClick={analyze}>
          <Check />
        </button>
      </header>
      <p className="am-editor-instruction">
        Choose a piece, then tap a square to place it.
      </p>
      <div className="am-editor-palette" aria-label="Piece palette">
        {["w", "b"].map((color) => (
          <div className="am-editor-palette-row" key={color}>
            {["k", "q", "r", "b", "n", "p"].map((type) => {
              const piece = color + type;
              return (
                <button
                  type="button"
                  aria-label={`Place ${label(piece)}`}
                  aria-pressed={brush === piece}
                  key={piece}
                  onClick={() => setBrush(piece)}
                >
                  <img src={sourceFor(piece)} alt="" draggable="false" />
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="am-editor-tools">
        <button
          type="button"
          onClick={() => setBrush("")}
          aria-pressed={!brush}
        >
          <Eraser />
          <span>Erase</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setFlipped((v) => !v);
          }}
        >
          <FlipVertical2 />
          <span>Flip</span>
        </button>
        <button
          type="button"
          onClick={() =>
            update({
              pieces: {},
              castling: "",
              enPassant: "-",
              halfmove: "0",
              fullmove: "1",
            })
          }
        >
          <Trash2 />
          <span>Clear</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(positionDraft(draft.variant === "chess960" ? chess960Fen() : START_POSITION, draft.variant));
            setError("");
            setMessage("");
          }}
        >
          <RotateCcw />
          <span>Start</span>
        </button>
      </div>
      <div
        className={`am-editor-board ${prefs.coordinates === false ? "am-editor-no-coordinates" : ""}`}
        aria-label="Position editor board"
        style={{
          "--editor-light": colors.light,
          "--editor-dark": colors.dark,
        }}
      >
        {squares.map((square, index) => (
          <button
            type="button"
            key={square}
            data-square={square}
            aria-label={`Edit ${square}${draft.pieces[square] ? `: ${label(draft.pieces[square])}` : ": empty"}`}
            className={
              (square.charCodeAt(0) + Number(square[1])) % 2
                ? "am-editor-light"
                : "am-editor-dark"
            }
            onClick={() => place(square)}
            onContextMenu={(e) => {
              e.preventDefault();
              place(square, "");
            }}
          >
            {draft.pieces[square] && (
              <img
                src={sourceFor(draft.pieces[square])}
                alt=""
                draggable="false"
              />
            )}
            {index % 8 === 0 && (
              <span className="am-editor-rank" aria-hidden="true">
                {square[1]}
              </span>
            )}
            {index >= 56 && (
              <span className="am-editor-file" aria-hidden="true">
                {square[0]}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="am-editor-fields">
        <label className="am-editor-turn">Rules<select aria-label="Position rules" value={draft.variant} onChange={e=>update({variant:e.target.value,castling:""})}><option value="standard">Standard</option><option value="chess960">Chess960</option></select></label>
        <label className="am-editor-turn">
          Side to move
          <select
            aria-label="Side to move"
            value={draft.turn}
            onChange={(e) => update({ turn: e.target.value, enPassant: "-" })}
          >
            <option value="w">White</option>
            <option value="b">Black</option>
          </select>
        </label>
        <fieldset>
          <legend>Castling rights</legend>
          <div className="am-editor-castling">
            {castleChoices.map(([right, text]) => (
              <label key={right}>
                <input
                  type="checkbox"
                  checked={draft.castling.includes(right)}
                  onChange={(e) =>
                    update({
                      castling: e.target.checked
                        ? draft.castling + right
                        : draft.castling.replace(right, ""),
                    })
                  }
                />
                {text}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="am-editor-meta">
          <label>
            En passant
            <select
              aria-label="En passant square"
              value={draft.enPassant}
              onChange={(e) => update({ enPassant: e.target.value })}
            >
              <option value="-">None</option>
              {[..."abcdefgh"].map((file) => {
                const square = file + (draft.turn === "w" ? "6" : "3");
                return (
                  <option key={square} value={square}>
                    {square}
                  </option>
                );
              })}
            </select>
          </label>
          <label>
            Halfmove clock
            <input
              aria-label="Halfmove clock"
              type="number"
              min="0"
              step="1"
              value={draft.halfmove}
              onChange={(e) => update({ halfmove: e.target.value })}
            />
          </label>
          <label>
            Move number
            <input
              aria-label="Move number"
              type="number"
              min="1"
              step="1"
              value={draft.fullmove}
              onChange={(e) => update({ fullmove: e.target.value })}
            />
          </label>
        </div>
        <label className="am-editor-fen-label">
          Current FEN
          <textarea
            aria-label="Current FEN"
            readOnly
            value={fen}
            spellCheck="false"
          />
        </label>
        <button
          type="button"
          className="am-editor-copy"
          onClick={async () => {
            const copied = await copyMobileText(fen);
            setMessage(
              copied ? "FEN copied." : "Select and copy the FEN above.",
            );
          }}
        >
          <Copy size={16} />
          Copy FEN
        </button>
        <label className="am-editor-fen-label">
          Paste a FEN
          <textarea
            aria-label="Paste a FEN"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste all six FEN fields"
            spellCheck="false"
          />
        </label>
        <button
          type="button"
          className="am-editor-load"
          onClick={loadFen}
          disabled={!input.trim()}
        >
          Load FEN
        </button>
        {error && (
          <p className="am-editor-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="am-editor-message" role="status">
            {message}
          </p>
        )}
        <button
          type="button"
          className="am-primary am-editor-analyze"
          onClick={analyze}
        >
          Analyze Position
        </button>
      </div>
    </section>
  );
}
