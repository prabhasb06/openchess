import React, {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useId,
} from "react";
import { Star, X } from "lucide-react";
import appearance from "./appearance.json";
import { localBoard, localPiece } from "./android/local-art";
import "./native-board.css";
import { mobileHaptic } from "./mobile-api";
import { nativeDynamicMotion, sampleNativeDynamic } from "./android/native-motion";
import { startNativeSpringRenderer } from "./android/native-spring-renderer";
import {
  reconcilePieces,
  movementDuration,
  movementEasing,
  captureFrames,
} from "./board-motion";
const names = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};
export function Board({
  game,
  prefs,
  flipped = false,
  onMove,
  lastMove,
  hint,
  disabled = false,
  decorative = false,
  onIllegal,
  tutorialArrows = [],
  markers = [],
  legacySpringMode,
}) {
  const [selected, setSelected] = useState(null),
    [drag, setDrag] = useState(null),
    [promotion, setPromotion] = useState(null),
    [arrows, setArrows] = useState([]),
    [marks, setMarks] = useState([]),
    [hoverSquare, setHoverSquare] = useState(null);
  const el = useRef(),
    touchHalo = useRef(),
    right = useRef(),
    press = useRef(null),
    frame = useRef(0),
    pendingDrop = useRef(null),
    motions = useRef(new Map()),
    ghosts = useRef(new Set()),
    scene = useRef({ pieces: [], flipped }),
    counter = useRef(0),
    pieceModel = useRef([]);
  const arrowId = "arrow-" + useId().replaceAll(":", "");
  const fen = game.fen();
  const nativeMobile = prefs.nativeMobile === true;
  useEffect(() => {
    if (!nativeMobile || decorative) return;
    const node = el.current;
    // The board handles input through PointerEvents. Stop Chromium's native
    // touch gesture recognizer from swallowing the next UI tap after a drag.
    // Promotion buttons retain normal browser click behavior.
    const ownTouch = (event) => {
      if (event.target.closest?.(".square")) event.preventDefault();
    };
    node?.addEventListener("touchstart", ownTouch, { passive: false });
    return () => node?.removeEventListener("touchstart", ownTouch);
  }, [nativeMobile, decorative]);
  useEffect(() => {
    if (!nativeMobile || !promotion) return;
    const back = (event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      setPromotion(null);
    };
    window.addEventListener("chess-native-back", back);
    return () => window.removeEventListener("chess-native-back", back);
  }, [nativeMobile, promotion]);
  const rotation = nativeMobile && prefs.rotatePieces ? " rotate(180deg)" : "";
  const pieces = useMemo(() => {
    const next = reconcilePieces(
      pieceModel.current,
      game.board().flat().filter(Boolean),
      () => ++counter.current,
    );
    pieceModel.current = next;
    return next;
  }, [fen]);
  const mobileBoard = nativeMobile ? localBoard(prefs.mobileBoard) : null;
  const pieceStyle = appearance.pieces.find((p) => p.id === prefs.pieceStyle),
    boardStyle = appearance.boards.find((b) => b.id === prefs.board),
    boardTexture = nativeMobile ? null : prefs.boardTexture || boardStyle?.image;
  const outsideCoords =
    prefs.coordinates && prefs.coordinatePosition === "outside";
  const files = flipped ? "hgfedcba" : "abcdefgh",
    ranks = flipped ? "12345678" : "87654321";
  const squares = [...ranks].flatMap((r) => [...files].map((f) => f + r));
  const coords = (s) => ({ x: files.indexOf(s[0]), y: ranks.indexOf(s[1]) });
  const sourceFor = (p) => nativeMobile
    ? localPiece(p.color + p.type, prefs.mobilePieces)
    : prefs.pieceImages?.[p.color + p.type] ||
    pieceStyle?.assets[p.color + p.type] ||
    `/pieces/${p.color + p.type}.png`;
  const nodeFor = (id) => el.current?.querySelector(`[data-visual-id="${id}"]`);
  const squareAt = (e) => {
    const r = el.current.getBoundingClientRect(),
      x = Math.floor(((e.clientX - r.left) / r.width) * 8),
      y = Math.floor(((e.clientY - r.top) / r.height) * 8);
    return x < 0 || x > 7 || y < 0 || y > 7 ? null : files[x] + ranks[y];
  };
  const availableFrom = (from) => {
    const legal = game.moves({ square: from, verbose: true });
    if (game.get(from)?.type === "p")
      for (const to of markers)
        if (
          Math.abs(to.charCodeAt(0) - from.charCodeAt(0)) === 1 &&
          +to[1] - +from[1] === (game.turn() === "w" ? 1 : -1)
        )
          legal.push({ to });
    return legal;
  };
  const legal = selected ? availableFrom(selected) : [];
  function stopMotion(id) {
    const a = motions.current.get(id);
    if (a) {
      a.cancel();
      motions.current.delete(id);
      const node = a.effect?.target;
      if (node) {
        node.style.transformOrigin = "";
        node.style.zIndex = "";
      }
    }
  }
  let springMode;
  if (nativeMobile) {
    switch (prefs.mobileAnimation) {
      case "fast": springMode = "FAST"; break;
      case "simple": springMode = "SIMPLE"; break;
      case "legacy": springMode = legacySpringMode; break;
    }
  }
  function animateTo(node, id, dx, dy, duration, origin) {
    if (Math.abs(dx) < 0.2 && Math.abs(dy) < 0.2) return;
    node.style.zIndex = "4";
    if (springMode) {
      const a = startNativeSpringRenderer(node, {
        ...origin,dx,dy,mode:springMode,
        // CSS/View-pixel mapping of this renderer;2.8125 on the captured A36.
        pixelsPerCssPixel: window.devicePixelRatio || 1,
        facing: () => el.current?.classList.contains("rotate-piece-faces") ? 180 : 0,
        onFinish: () => {if(motions.current.get(id)===a){motions.current.delete(id);node.style.zIndex="";}},
      });
      motions.current.set(id,a);
      return;
    }
    const nativeDynamic = nativeMobile && (prefs.mobileAnimation || "dynamic") === "dynamic";
    const cell = el.current.getBoundingClientRect().width / 8;
    const move = { deltaX: -dx, deltaY: -dy, squareSize: cell };
    const spec = nativeDynamic
      ? nativeDynamicMotion(move, { frameIntervalMs: 1000 / 60 })
      : null;
    // Native tilt pivots near the top. Facing still rotates around the center,
    // otherwise Black's pieces jump outside their square when the pivot changes.
    const facing = rotation
      ? ` translateY(${cell * 0.4}px)${rotation} translateY(${-cell * 0.4}px)`
      : "";
    if (spec) node.style.transformOrigin = spec.pivot;
    const a = node.animate(
      spec ? spec.frames.map(frame => ({ ...frame, transform: frame.transform + facing })) : [
        { transform: `translate(${dx}px,${dy}px)${rotation}` },
        { transform: `translate(0px,0px)${rotation}` },
      ],
      {
        duration: spec?.duration || duration,
        easing: spec?.easing || movementEasing(prefs.animationSpeed),
        fill: spec ? "both" : "none",
      },
    );
    if (spec) a.nativeMove = move;
    motions.current.set(id, a);
    a.onfinish = () => {
      if (motions.current.get(id) === a) {
        motions.current.delete(id);
        node.style.zIndex = "";
        node.style.transformOrigin = "";
        if (spec) a.cancel();
      }
    };
  }
  function cancelPress() {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = 0;
    const p = press.current;
    press.current = null;
    if (p) {
      const node = nodeFor(p.id);
      if (node) {
        node.style.transform = "";
        node.style.zIndex = "";
      }
      try {
        el.current?.releasePointerCapture(p.pointerId);
      } catch {}
    }
    setDrag(null);
    setHoverSquare(null);
  }
  useEffect(() => {
    setSelected(null);
    setPromotion(null);
    setArrows([]);
    setMarks([]);
    cancelPress();
  }, [fen, flipped, disabled]);
  useEffect(
    () => () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      for (const id of motions.current.keys()) stopMotion(id);
      for (const g of ghosts.current) g.remove();
    },
    [],
  );
  useLayoutEffect(() => {
    const old = scene.current,
      drop = pendingDrop.current;
    pendingDrop.current = null;
    const canAnimate =
      prefs.animation &&
      !drop &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches &&
      old.flipped === flipped;
    const rect = el.current.getBoundingClientRect(),
      cell = rect.width / 8;
    const changed = pieces.filter((p) => {
      const o = old.pieces.find((o) => o.id === p.id);
      return o && o.square !== p.square;
    });
    if (old.flipped !== flipped || changed.length > 2) {
      for (const id of motions.current.keys()) stopMotion(id);
      for (const g of ghosts.current) g.remove();
      ghosts.current.clear();
    }
    for (const p of pieces) {
      const node = nodeFor(p.id),
        before = old.pieces.find((o) => o.id === p.id);
      if (!node) continue;
      if ((before && before.square !== p.square) || drop?.id === p.id) {
        const running = motions.current.get(p.id);
        const to = coords(p.square),
          from = before ? coords(before.square) : to;
        if (canAnimate && running?.nativeSpring && running.mode === springMode) {
          running.retarget({left:to.x*cell,top:to.y*cell});
          continue;
        }
        let tx = 0,
          ty = 0;
        if (running) {
          if (running.nativeSpring) {
            tx = running.offset.x;
            ty = running.offset.y;
          } else if (running.nativeMove) {
            const current = sampleNativeDynamic(Number(running.currentTime) || 0, running.nativeMove);
            tx = current.x;
            ty = current.y;
          } else {
            const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform);
            tx = matrix.m41;
            ty = matrix.m42;
          }
        }
        stopMotion(p.id);
        node.style.transform = "";
        node.style.zIndex = "";
        let dx = (from.x - to.x) * cell + tx,
          dy = (from.y - to.y) * cell + ty;
        if (drop?.id === p.id) {
          dx = drop.left - rect.left - to.x * cell;
          dy = drop.top - rect.top - to.y * cell;
        }
        if (canAnimate)
          animateTo(
            node,
            p.id,
            dx,
            dy,
            movementDuration(prefs.animationSpeed, Math.hypot(dx, dy) / cell),
            {left:to.x*cell,top:to.y*cell},
          );
      }
    }
    // A captured piece remains below its attacker during the travel, never above it.
    if (canAnimate && changed.length && changed.length <= 2)
      for (const victim of old.pieces.filter(
        (o) => !pieces.some((p) => p.id === o.id),
      )) {
        const at = coords(victim.square),
          ghost = document.createElement("img");
        ghost.className = "captured-ghost";
        ghost.src = sourceFor(victim);
        ghost.alt = "";
        ghost.style.left = at.x * 12.5 + "%";
        ghost.style.top = at.y * 12.5 + "%";
        el.current.querySelector(".pieces").append(ghost);
        ghosts.current.add(ghost);
        const a = ghost.animate(captureFrames(prefs.animationSpeed), {
          duration: movementDuration(prefs.animationSpeed, 1),
          easing: movementEasing(prefs.animationSpeed),
        });
        a.onfinish = () => {
          ghosts.current.delete(ghost);
          ghost.remove();
        };
      }
    scene.current = { pieces: pieces.map((p) => ({ ...p })), flipped };
    if (nativeMobile && drag && press.current) positionTouchHalo(press.current);
  }, [fen, flipped, drag]);
  function castlingDestination(from, to) {
    if (!from || !to) return null;
    const king = game.get(from),
      rook = game.get(to);
    if (king?.type !== "k" || rook?.type !== "r" || king.color !== rook.color)
      return null;
    if (game.variant === "chess960")
      return availableFrom(from).find(move => move.castle && move.rookFrom === to)?.to || null;
    if (prefs.castlingMethod !== "rook") return null;
    // Alias only an already-legal castle. The rules engine still decides rights,
    // empty transit squares, check and attacked king paths.
    const castle = availableFrom(from).find(
      (move) =>
        (move.flags?.includes("k") && to === "h" + from[1]) ||
        (move.flags?.includes("q") && to === "a" + from[1]),
    );
    return castle?.to || null;
  }
  function move(from, to) {
    const destination = castlingDestination(from, to) || to;
    const available = availableFrom(from).filter((m) => m.to === destination);
    if (!available.length) {
      if (from !== to) onIllegal?.();
      return false;
    }
    if (available.some((m) => m.promotion) && !prefs.autoQueen)
      setPromotion({ from, to: destination, color: game.turn() });
    else {
      const accepted = onMove?.(from, destination, "q");
      if (accepted !== false && nativeMobile && prefs.haptics) mobileHaptic();
    }
    setSelected(null);
    setArrows([]);
    setMarks([]);
    return true;
  }
  function click(s, previous = selected) {
    if (decorative || disabled || promotion || prefs.moveMethod === "drag")
      return;
    const p = game.get(s);
    if (
      previous &&
      (p?.color !== game.turn() || castlingDestination(previous, s))
    ) {
      if (move(previous, s)) return;
      // Keep the selected piece after a rejected destination so the player can retry.
      setSelected(previous);
      return;
    }
    setSelected(previous === s ? null : p?.color === game.turn() ? s : null);
    setArrows([]);
    setMarks([]);
  }
  function pointerDown(e) {
    if (decorative || !e.isPrimary) return;
    const s = squareAt(e);
    if (!s) return;
    if (e.button === 2) {
      right.current = s;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {}
      return;
    }
    if (disabled || promotion || e.button !== 0) return;
    e.preventDefault();
    const own = game.get(s)?.color === game.turn(),
      piece = pieces.find((p) => p.square === s),
      node = own ? nodeFor(piece?.id) : null;
    const rect = node?.getBoundingClientRect();
    press.current = {
      from: s,
      id: piece?.id,
      previous: selected,
      own,
      pointerId: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      grabX: rect ? e.clientX - rect.left : 0,
      grabY: rect ? e.clientY - rect.top : 0,
      moved: false,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    if (own) {
      if (!nativeMobile) setSelected(s);
      setArrows([]);
      setMarks([]);
      stopMotion(piece.id);
    }
  }
  function paintDrag() {
    frame.current = 0;
    const p = press.current;
    if (!p?.moved) return;
    const node = nodeFor(p.id);
    if (!node) return;
    const rect = el.current.getBoundingClientRect(),
      c = coords(p.from),
      cell = rect.width / 8;
    if (nativeMobile) {
      // Phase captures show the magnified piece above the finger, rather than
      // a desktop grab offset. Exact drag thresholds/frame timing remain unknown.
      const magnify = prefs.magnifyPieces !== false;
      const dx = p.x - rect.left - (c.x + 0.5) * cell;
      const dy =
        p.y - rect.top - (c.y + 0.5) * cell - (magnify ? 0.9 * cell : 0);
      node.style.transform = `translate(${dx}px,${dy}px) scale(${magnify ? 2 : 1})${rotation}`;
      positionTouchHalo(p, rect);
    } else {
      node.style.transform = `translate(${p.x - p.grabX - rect.left - c.x * cell}px,${p.y - p.grabY - rect.top - c.y * cell}px)`;
    }
    node.style.zIndex = "10";
  }
  function positionTouchHalo(
    pointer,
    rect = el.current.getBoundingClientRect(),
  ) {
    if (!touchHalo.current) return;
    touchHalo.current.style.left = `${pointer.x - rect.left}px`;
    touchHalo.current.style.top = `${pointer.y - rect.top}px`;
  }
  function pointerMove(e) {
    const p = press.current;
    if (
      !p ||
      p.pointerId !== e.pointerId ||
      !p.own ||
      prefs.moveMethod === "click"
    )
      return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (!p.moved && Math.hypot(p.x - p.x0, p.y - p.y0) > 4) {
      p.moved = true;
      if (nativeMobile) setSelected(p.from);
      setDrag({ from: p.from });
    }
    if (p.moved) {
      setHoverSquare(squareAt(e));
      if (!frame.current) frame.current = requestAnimationFrame(paintDrag);
    }
  }
  function pointerUp(e) {
    const to = squareAt(e);
    if (e.button === 2 && right.current) {
      const from = right.current;
      right.current = null;
      if (to === from)
        setMarks((a) =>
          a.includes(to) ? a.filter((s) => s !== to) : [...a, to],
        );
      else if (to) {
        const key = from + to;
        setArrows((a) =>
          a.some((v) => v.join("") === key)
            ? a.filter((v) => v.join("") !== key)
            : [...a, [from, to]],
        );
      }
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
      return;
    }
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    if (disabled) {
      cancelPress();
      return;
    }
    if (p.moved) {
      p.x = e.clientX;
      p.y = e.clientY;
      if (frame.current) cancelAnimationFrame(frame.current);
      paintDrag();
      const r = nodeFor(p.id)?.getBoundingClientRect();
      if (r) pendingDrop.current = { id: p.id, left: r.left, top: r.top };
      press.current = null;
      setDrag(null);
      setHoverSquare(null);
      if (to) move(p.from, to);
      else setSelected(null);
    } else {
      press.current = null;
      click(to || p.from, p.previous);
      if (prefs.moveMethod === "drag") setSelected(null);
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
  }
  const allArrows = [
    ...arrows,
    ...tutorialArrows,
    ...(hint && hint.length >= 4 ? [[hint.slice(0, 2), hint.slice(2, 4)]] : []),
  ];
  return (
    <div
      className={
        "chessboard " +
        (decorative ? "decorative " : "") +
        (prefs.animation ? "animated" : "") +
        (boardTexture ? " themed-board" : "") +
        (outsideCoords ? " outside-coordinates" : "") +
        (drag ? " is-dragging" : "") +
        (nativeMobile ? " native-mobile" : "") +
        (nativeMobile && prefs.rotatePieces ? " rotate-piece-faces" : "")
      }
      ref={el}
      style={
        boardTexture
          ? {
              backgroundImage: `url(${boardTexture})`,
              backgroundSize: "100% 100%",
              "--light": prefs.themeLight || "#ebecd0",
              "--dark": prefs.themeDark || "#739552",
              "--move-highlight": prefs.themeHighlight || "#ffff33",
            }
          : mobileBoard
            ? {
                "--light": mobileBoard.light,
                "--dark": mobileBoard.dark,
                "--move-highlight": mobileBoard.id === "green" ? "#ffff33" : "#f3ce7b",
              }
            : {}
      }
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={() => {
        cancelPress();
        setSelected(null);
      }}
      onLostPointerCapture={(e) => {
        if (press.current?.pointerId === e.pointerId) {
          cancelPress();
          setSelected(null);
        }
        right.current = null;
      }}
      onDragStart={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          cancelPress();
          setSelected(null);
          setPromotion(null);
          setArrows([]);
          setMarks([]);
        }
      }}
    >
      {squares.map((s, i) => {
        const light = (s.charCodeAt(0) + Number(s[1])) % 2 !== 0,
          p = game.get(s);
        return (
          <button
            key={s}
            className={
              "square " +
              (light ? "light" : "dark") +
              (selected === s ? " selected" : "") +
              (drag && hoverSquare === s ? " drop-target" : "") +
              (prefs.lastMove !== false &&
              lastMove &&
              (s === lastMove.from || s === lastMove.to)
                ? " last-move"
                : "") +
              (marks.includes(s) ? " marked" : "") +
              (p?.type === "k" && p.color === game.turn() && game.isCheck()
                ? " in-check"
                : "")
            }
            data-square={s}
            aria-label={`${s}${p ? " " + (p.color === "w" ? "white" : "black") + " " + names[p.type] : ""}`}
            tabIndex={decorative ? -1 : 0}
            onClick={(e) => {
              if (e.detail === 0) click(s);
            }}
          >
            {prefs.coordinates && !outsideCoords && i % 8 === 0 && (
              <span className="rank">{s[1]}</span>
            )}
            {prefs.coordinates && !outsideCoords && i >= 56 && (
              <span className="file">{s[0]}</span>
            )}
            {prefs.legal && legal.some((m) => m.to === s) && (
              <span className={p ? "legal-capture" : "legal-dot"} />
            )}
          </button>
        );
      })}
      {outsideCoords && (
        <div className="outside-coordinate-labels" aria-hidden="true">
          {[...ranks].map((r, i) => (
            <span
              key={r}
              className="outside-rank"
              style={{ top: (i + 0.5) * 12.5 + "%" }}
            >
              {r}
            </span>
          ))}
          {[...files].map((f, i) => (
            <span
              key={f}
              className="outside-file"
              style={{ left: (i + 0.5) * 12.5 + "%" }}
            >
              {f}
            </span>
          ))}
        </div>
      )}
      {markers.map((s) => {
        const c = coords(s);
        return (
          <span
            key={s}
            className="teaching-star"
            style={{ left: c.x * 12.5 + "%", top: c.y * 12.5 + "%" }}
          >
            <Star size="60%" fill="#ffd453" stroke="#fff5b8" />
          </span>
        );
      })}
      {nativeMobile && drag && (
        <div className="native-touch-halo" ref={touchHalo} aria-hidden="true" />
      )}
      <div className="pieces" aria-hidden="true">
        {pieces.map((p) => {
          const c = coords(p.square);
          return (
            <img
              key={p.id}
              data-visual-id={p.id}
              data-piece={p.square}
              src={sourceFor(p)}
              className={"piece " + (drag?.from === p.square ? "dragging" : "")}
              alt=""
              draggable="false"
              style={{
                left: c.x * 12.5 + "%",
                top: c.y * 12.5 + "%",
              }}
            />
          );
        })}
      </div>
      {!!allArrows.length && (
        <svg className="arrows" viewBox="0 0 800 800">
          <defs>
            <marker
              id={arrowId}
              markerWidth="3"
              markerHeight="3"
              refX="2.15"
              refY="1.5"
              orient="auto"
            >
              <path d="M0,0 L3,1.5 L0,3 Z" fill="#f6a42be0" />
            </marker>
          </defs>
          {allArrows.map(([f, t], i) => {
            const a = coords(f),
              b = coords(t);
            return (
              <line
                key={i}
                x1={a.x * 100 + 50}
                y1={a.y * 100 + 50}
                x2={b.x * 100 + 50}
                y2={b.y * 100 + 50}
                stroke="#f6a42be0"
                strokeWidth="20"
                markerEnd={`url(#${arrowId})`}
              />
            );
          })}
        </svg>
      )}
      {promotion && (
        <div className="promotion-cover">
          <div className="promotion-picker">
            <span>Promote to</span>
            {["q", "r", "b", "n"].map((p) => (
              <button
                key={p}
                aria-label={"Promote to " + names[p]}
                onClick={() => {
                  const accepted = onMove(promotion.from, promotion.to, p);
                  if (accepted !== false && nativeMobile && prefs.haptics)
                    mobileHaptic();
                  setPromotion(null);
                }}
              >
                <img
                  src={sourceFor({ color: promotion.color, type: p })}
                  alt={names[p]}
                />
              </button>
            ))}
            <button
              aria-label="Cancel promotion"
              onClick={() => setPromotion(null)}
            >
              <X />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
