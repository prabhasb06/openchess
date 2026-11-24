import React, { useEffect, useMemo, useState } from "react";
import { Chess } from "chess.js";
import { Shuffle, X, ChevronDown, ChevronRight, Settings } from "lucide-react";
import { MobileHeader, MobileColorIcon } from "./chrome";
import { adjustableBot, mobileBots } from "./local-bots";
import { localBotAvatar, localPiece } from "./local-art";
import { readRulesPgn } from "../chess-rules";
import { mobileServer } from "../mobile-api";
import "./play.css";

export { mobileBots };
const catalogBotGroups = [
  { id: "practice", name: "Practice", bots: mobileBots.slice(0, 4) },
  { id: "challenge", name: "Challenge", bots: mobileBots.slice(4, -1) },
  { id: "engine", name: "Engine", bots: [adjustableBot] },
];
export const MOBILE_TIME_CONTROLS = [
  [60, 0, "1 min"],
  [60, 1, "1 | 1"],
  [120, 1, "2 | 1"],
  [180, 0, "3 min"],
  [180, 2, "3 | 2"],
  [300, 0, "5 min"],
  [300, 5, "5 | 5"],
  [600, 0, "10 min"],
  [600, 5, "10 | 5"],
  [900, 10, "15 | 10"],
  [1200, 0, "20 min"],
  [1800, 0, "30 min"],
  [3600, 0, "60 min"],
  [0, 0, "No Timer"],
];
export function MobileTimePicker({
  value = 0,
  increment = 0,
  onSelect,
  onClose,
}) {
  useEffect(() => {
    const back = (event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("chess-native-back", back);
    return () => window.removeEventListener("chess-native-back", back);
  }, [onClose]);
  return (
    <div
      className="am-play-modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        className="am-play-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Time Control"
      >
        <header>
          <h2>Time Control</h2>
          <button aria-label="Close time controls" onClick={onClose}>
            <X />
          </button>
        </header>
        <div className="am-time-grid">
          {MOBILE_TIME_CONTROLS.map(([time, inc, label]) => (
            <button
              key={label}
              className={time === value && inc === increment ? "selected" : ""}
              onClick={() => {
                onSelect(time, inc);
                onClose();
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
export function MobileLocalSetup({
  prefs = {},
  onBack,
  onStart,
  onNavigate,
  onContinue,
  hasSession,
}) {
  const [names, setNames] = useState({
      w: prefs.name || "Guest",
      b: "Opponent",
    }),
    [time, setTime] = useState(0),
    [increment, setIncrement] = useState(0),
    [rotates, setRotates] = useState(false),
    [picker, setPicker] = useState(false),
    [type, setType] = useState("Standard"),
    [fen, setFen] = useState("");
  const label =
    MOBILE_TIME_CONTROLS.find(([t, i]) => t === time && i === increment)?.[2] ||
    "No Timer";
  return (
    <section className={`am-local-setup${hasSession ? " has-session" : ""}`}>
      <MobileHeader title="Play in Person" icon="in-person" onBack={onBack} />
      <h2 className="am-local-description">Play with a friend offline</h2>
      <div className="am-local-fields">
        {["w", "b"].map((color) => (
          <label key={color} className="am-local-field">
            <span>{color === "w" ? "White" : "Black"}</span>
            <input
              aria-label={`${color === "w" ? "White" : "Black"} player name`}
              maxLength={40}
              value={names[color]}
              onChange={(e) => setNames({ ...names, [color]: e.target.value })}
            />
          </label>
        ))}
        <button
          className="am-local-swap"
          aria-label="Swap player colors"
          onClick={() => setNames({ w: names.b, b: names.w })}
        >
          <Shuffle />
        </button>
        <label className="am-local-field">
          <span>Type</span>
          <select
            aria-label="Game type"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option>Standard</option>
            <option>Chess960</option>
            <option>Custom Position</option>
          </select>
        </label>
        {type === "Custom Position" && (
          <label className="am-local-fen">
            <span>Starting position (FEN)</span>
            <textarea
              value={fen}
              onChange={(e) => setFen(e.target.value)}
              spellCheck={false}
              aria-label="Starting FEN"
            />
          </label>
        )}
        {type === "Chess960" && <p className="am-local-rules-note">Random starting position. Castle by moving your king onto its rook.</p>}
        <button className="am-local-field" onClick={() => setPicker(true)}>
          <span>Time Control</span>
          <b>{label}</b>
        </button>
        <label className="am-local-field">
          <span>Board Rotates</span>
          <input
            className="am-switch"
            type="checkbox"
            checked={rotates}
            onChange={(e) => setRotates(e.target.checked)}
          />
        </label>
      </div>
      <div className="am-setup-play-dock">
        {hasSession && (
          <button className="am-surface" onClick={onContinue}>
            Continue Game
          </button>
        )}
        <button
          className="am-primary"
          onClick={() =>
            onStart({
              mode: "local",
              names,
              timeControl: time,
              increment,
              boardRotates: rotates,
              ...(type === "Chess960" ? {variant:"chess960"} : {}),
              ...(type === "Custom Position" ? { fen } : {}),
            })
          }
        >
          Play
        </button>
      </div>
      {picker && (
        <MobileTimePicker
          value={time}
          increment={increment}
          onSelect={(t, i) => {
            setTime(t);
            setIncrement(i);
          }}
          onClose={() => setPicker(false)}
        />
      )}
    </section>
  );
}
export function MobileBots({
  selected,
  onSelect,
  onStart,
  onContinue,
  onBack,
  hasSession = false,
  prefs = {},
  onUnavailable,
  saved = [],
}) {
  const [options, setOptions] = useState(false),
    [side, setSide] = useState("w"),
    [time, setTime] = useState(0),
    [increment, setIncrement] = useState(0),
    [picker, setPicker] = useState(false);
  useEffect(() => {
    if (!options || picker) return;
    const back = (event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      setOptions(false);
    };
    window.addEventListener("chess-native-back", back);
    return () => window.removeEventListener("chess-native-back", back);
  }, [options, picker]);
  const bot = selected || catalogBotGroups[0].bots[0];
  const timeLabel = MOBILE_TIME_CONTROLS.find(([t, i]) => t === time && i === increment)?.[2];
  function play() {
    const color = side === "random" ? (Math.random() < 0.5 ? "w" : "b") : side;
    onStart({
      mode: "bot",
      bot,
      side: color,
      flipped: color === "b",
      timeControl: time,
      increment,
      names: {
        w: color === "w" ? prefs.name || "Guest" : bot.name,
        b: color === "b" ? prefs.name || "Guest" : bot.name,
      },
    });
  }
  const wonAgainst = useMemo(
    () =>
      new Set(
        saved.flatMap((record) => {
          if (record.mode !== "bot") return [];
          try {
            const {game:g} = readRulesPgn(record.pgn);
            const h = g.getHeaders();
            return (h.Result === "1-0" &&
              h.Black === record.opponent &&
              h.White !== record.opponent) ||
              (h.Result === "0-1" &&
                h.White === record.opponent &&
                h.Black !== record.opponent)
              ? [record.opponent]
              : [];
          } catch {
            return [];
          }
        }),
      ),
    [saved],
  );
  return (
    <section className="am-bots-screen">
      <MobileHeader title="Bots" icon="device-bot" onBack={onBack} />
      <div className="am-bot-profile">
        <img src={localBotAvatar(bot)} alt={bot.name} />
        <p>{bot.text || "Ready for a game?"}</p>
        <div>
          <h1>
            {bot.name} {bot.rating != null && <small>{bot.rating}</small>}
          </h1>
        </div>
      </div>
      <div className="am-mobile-bot-catalog">
        {catalogBotGroups.map((group) => (
          <section key={group.id} className="am-bot-group">
            <h2>
              {group.name} <span>{group.bots.length}</span>
            </h2>
            <div>
              {group.bots.map((b) => {
                const won = wonAgainst.has(b.name);
                return (
                  <button
                    key={b.id}
                    className={b.id === bot.id ? "selected" : ""}
                    aria-label={b.rating == null ? b.name : `${b.name}, ${b.rating}`}
                    aria-pressed={b.id === bot.id}
                    onClick={() => onSelect(b)}
                  >
                    <img src={localBotAvatar(b)} alt="" />
                    {won && (
                      <span className="am-bot-crown" title="Local victory">
                        ♛
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      {bot.id === adjustableBot.id && (
        <label className="am-local-field am-engine-strength">
          <span>Strength <b>{bot.skill}</b></span>
          <input
            type="range"
            aria-label="Engine strength"
            min="0"
            max="20"
            step="1"
            value={bot.skill}
            onChange={(event) => onSelect({ ...bot, skill: Number(event.target.value) })}
          />
        </label>
      )}
      <div className="am-bot-start-dock">
        {hasSession && (
          <button className="am-surface" onClick={onContinue}>Continue Game</button>
        )}
        <div className="am-bot-start-controls">
          <button className="am-surface am-bot-dock-options" aria-haspopup="dialog" aria-expanded={options}
            onClick={() => setOptions(true)}>
            <MobileColorIcon name="custom-game" />
            <span>Options</span>
            <ChevronDown />
          </button>
          <div className="am-side-choices" role="group" aria-label="Starting color">
            {[
              ["w", "White", localPiece("wk")],
              ["random", "Random", null],
              ["b", "Black", localPiece("bk")],
            ].map(([s, label, icon]) => (
              <button key={s} type="button" aria-label={`Play as ${label}`} aria-pressed={side === s}
                data-bot-side={s} onClick={() => setSide(s)}>
                {icon ? <img src={icon} alt="" /> : <Shuffle aria-hidden="true" />}
              </button>
            ))}
          </div>
        </div>
        <button className="am-primary" onClick={play}>{hasSession ? "New Game" : "Play"}</button>
      </div>
      {options && (
        <div
          className="am-play-modal-backdrop"
          onClick={(e) => e.target === e.currentTarget && setOptions(false)}
        >
          <section
            className="am-play-dialog am-bot-options"
            role="dialog"
            aria-modal="true"
            aria-label="Bot game options"
          >
            <header>
              <h2>Options</h2>
              <button
                onClick={() => setOptions(false)}
                aria-label="Close bot options"
              >
                <X />
              </button>
            </header>
            <button className="am-local-field" onClick={() => setPicker(true)}>
              <span>Time Control</span>
              <b>{timeLabel}</b>
            </button>
            <p className="am-engine-explanation">
              {mobileServer()?.onDevice ? "Stockfish plays on this phone." : "Stockfish plays the moves."}
              {" "}The displayed levels are approximate.
            </p>
          </section>
        </div>
      )}
      {picker && (
        <MobileTimePicker
          value={time}
          increment={increment}
          onSelect={(t, i) => {
            setTime(t);
            setIncrement(i);
          }}
          onClose={() => setPicker(false)}
        />
      )}
    </section>
  );
}
