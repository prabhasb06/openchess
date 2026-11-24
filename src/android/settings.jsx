import React, { useEffect, useState } from "react";
import {
  User,
  Lock,
  Bell,
  Home,
  Palette,
  Grid2X2,
  Users,
  GraduationCap,
  Puzzle,
  Search,
  Bluetooth,
  Diamond,
  ChevronRight,
  Wifi,
} from "lucide-react";
import { MobileHeader } from "./chrome";
import { isAndroid, mobileServer, openMobileSettings, apiFetch } from "../mobile-api";
import { localBoard, localBoards, localPiece } from "./local-art";
import "./settings.css";

const rows = [
  ["Upgrade", "Membership", Diamond],
  ["Profile", "profile", User],
  ["Account", "Account", Lock],
  ["Notifications", "Notifications", Bell],
  ["Home", "home", Home],
  ["Theme", "theme", Palette],
  ["Board", "board", Grid2X2],
  ["Play", "play", Puzzle],
  ["Social", "Social", Users],
  ["Coach", "Coach", GraduationCap],
  ["Puzzles", "puzzles", Puzzle],
  ["Analysis", "analysis", Search],
  ["Connected Boards", "Connected Boards", Bluetooth],
  ["Engine Connection", "connection", Wifi],
];
const localSections = new Set([
  "home",
  "theme",
  "board",
  "play",
  "puzzles",
  "analysis",
  "connection",
]);
function Toggle({ label, checked, onChange, help }) {
  return (
    <label className="am-setting-row">
      <span>
        {label}
        {help && <small>{help}</small>}
      </span>
      <input
        className="am-native-switch"
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
function Select({ label, value, onChange, options }) {
  return (
    <label className="am-setting-row am-setting-select">
      <span>
        {label}
        <select
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map(([v, l]) => (
            <option value={v} key={v}>
              {l}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}

export function MobileSettings({
  prefs = {},
  onChange,
  onBack,
  onNavigate,
  section,
}) {
  const [screen, setScreen] = useState(section || "root"),
    [health, setHealth] = useState(null),
    [checking, setChecking] = useState(false);
  useEffect(() => {
    setScreen(section || "root");
  }, [section]);
  const set = (key, value) => onChange?.(key, value);
  const back = () => {
    if (screen === "root" || section) onBack?.();
    else setScreen("root");
  };
  useEffect(() => {
    const backEvent = (e) => {
      if (screen !== "root" && !section) {
        e.preventDefault();
        setScreen("root");
      }
    };
    window.addEventListener("chess-native-back", backEvent);
    return () => window.removeEventListener("chess-native-back", backEvent);
  }, [screen, section]);
  async function testConnection() {
    setChecking(true);
    try {
      const res = await apiFetch("/api/health");
      const data = await res.json();
      setHealth(
        res.ok && data.ok
          ? { ok: true, message: data.onDevice ? `Stockfish ${data.version} is ready on this device.` : "Stockfish is connected." }
          : { ok: false, message: data.error || "The engine is unavailable." },
      );
    } catch (e) {
      setHealth({ ok: false, message: e.message || "Could not connect." });
    } finally {
      setChecking(false);
    }
  }
  const title =
    screen === "root"
      ? "Settings"
      : screen === "connection"
        ? "Engine Connection"
        : screen[0].toUpperCase() + screen.slice(1);
  return (
    <section className="am-settings-screen" data-settings-section={screen}>
      <MobileHeader title={title} onBack={back} />
      {screen === "root" && (
        <div className="am-setting-categories">
          {rows.map(([label, path, Icon]) => (
            <button
              key={path}
              onClick={() =>
                localSections.has(path) ? setScreen(path) : onNavigate?.(path)
              }
            >
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
      {screen === "board" && (
        <div className="am-board-settings">
          <Toggle
            label="Sounds"
            checked={prefs.sound !== false}
            onChange={(v) => set("sound", v)}
          />
          <Toggle
            label="Haptic Feedback"
            checked={prefs.haptics}
            onChange={(v) => set("haptics", v)}
          />
          <Toggle
            label="Show Coordinates"
            checked={prefs.coordinates !== false}
            onChange={(v) => set("coordinates", v)}
          />
          <Toggle
            label="Highlight Last Move"
            checked={prefs.lastMove !== false}
            onChange={(v) => set("lastMove", v)}
          />
          <Toggle
            label="Show Legal Moves"
            checked={prefs.legal !== false}
            onChange={(v) => set("legal", v)}
          />
          <Toggle
            label="Magnify Pieces"
            checked={prefs.magnifyPieces !== false}
            onChange={(v) => set("magnifyPieces", v)}
          />
          <Toggle
            label="Theme Showcase Animations"
            checked={prefs.themeAnimations !== false}
            onChange={(v) => set("themeAnimations", v)}
          />
          <Toggle
            label="Game Result Board Animations"
            checked={prefs.resultAnimations !== false}
            onChange={(v) => set("resultAnimations", v)}
          />
          <Select
            label="Game Over Screen"
            value={prefs.gameOverScreen || "full"}
            onChange={(v) => set("gameOverScreen", v)}
            options={[
              ["full", "Full-screen"],
              ["compact", "Classic"],
            ]}
          />
          <Select
            label="Piece Notation"
            value={prefs.notation || "figurine"}
            onChange={(v) => set("notation", v)}
            options={[
              ["figurine", "Figurine"],
              ["standard", "Letters"],
            ]}
          />
          <Select
            label="Castling Method"
            value={prefs.castlingMethod || "normal"}
            onChange={(v) => set("castlingMethod", v)}
            options={[
              ["normal", "Normal"],
              ["rook", "King onto rook"],
            ]}
          />
          <Select
            label="Piece Animations"
            value={prefs.mobileAnimation || "dynamic"}
            onChange={(v) => {
              set("mobileAnimation", v);
              set("animationSpeed", v === "fast" ? "fast" : "medium");
            }}
            options={[
              ["dynamic", "Dynamic"],
              ["fast", "Fast"],
              ["legacy", "Legacy"],
              ["playful", "Playful"],
              ["simple", "Simple"],
            ]}
          />
          <label className="am-setting-row am-volume">
            <span>Sound Volume</span>
            <input
              type="range"
              aria-label="Sound volume"
              min="0"
              max="1"
              step="0.05"
              value={prefs.volume ?? 0.8}
              onChange={(e) => set("volume", Number(e.target.value))}
            />
          </label>
        </div>
      )}
      {screen === "analysis" && (
        <div>
          <Toggle
            label="Quick Analysis"
            checked={prefs.quickAnalysis !== false}
            onChange={(v) => set("quickAnalysis", v)}
          />
          <Toggle
            label="Show Evaluation Bar"
            checked={prefs.eval !== false}
            onChange={(v) => set("eval", v)}
          />
          <Toggle
            label="Show Suggestion Arrows"
            checked={prefs.suggestionArrows}
            onChange={(v) => set("suggestionArrows", v)}
          />
          <Toggle
            label="Show Threat Arrows"
            checked={prefs.threatArrows}
            onChange={(v) => set("threatArrows", v)}
          />
          <Toggle
            label="Show Engine Lines"
            checked={prefs.engineLines !== false}
            onChange={(v) => set("engineLines", v)}
          />
          <div className="am-setting-note">
            Analysis uses Stockfish. Game Review
            classifications are local estimates.
          </div>
        </div>
      )}
      {screen === "home" && (
        <div>
          <Toggle
            label="Daily Puzzle"
            checked={prefs.homeDaily !== false}
            onChange={(v) => set("homeDaily", v)}
          />
          <Toggle
            label="Recommended Matches"
            checked={prefs.homeRecommended !== false}
            onChange={(v) => set("homeRecommended", v)}
          />
          <Toggle
            label="Show Streaks"
            checked={prefs.homeStreak !== false}
            onChange={(v) => set("homeStreak", v)}
          />
          <Toggle
            label="Use Classic Layout"
            checked={prefs.homeClassic}
            onChange={(v) => set("homeClassic", v)}
          />
        </div>
      )}
      {screen === "theme" && (
        <div className="am-appearance-settings">
          <h2>Board</h2>
          <div className="am-board-style-grid">
            {localBoards.map((board) => (
              <button
                className={localBoard(prefs.mobileBoard).id === board.id ? "selected" : ""}
                key={board.id}
                aria-label={`Board ${board.name}`}
                onClick={() => set("mobileBoard", board.id)}
              >
                <span className="am-board-swatch" aria-hidden="true" style={{ "--swatch-light": board.light, "--swatch-dark": board.dark }} />
                <span>{board.name}</span>
              </button>
            ))}
          </div>
          <h2>Pieces</h2>
          <div className="am-piece-style-grid">
            {[{ id: "amber", name: "Amber" }, { id: "violet", name: "Violet" }].map((style) => (
              <button
                className={
                  (prefs.mobilePieces || "amber") === style.id ? "selected" : ""
                }
                key={style.id}
                onClick={() => set("mobilePieces", style.id)}
              >
                <img src={localPiece("wn", style.id)} alt="" />
                <span>{style.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {screen === "play" && (
        <div>
          <button
            className="am-setting-row"
            onClick={() => onNavigate?.("Live Chess Settings")}
          >
            Live Chess
            <ChevronRight />
          </button>
          <button
            className="am-setting-row"
            onClick={() => onNavigate?.("Daily Chess Settings")}
          >
            Daily Chess
            <ChevronRight />
          </button>
          <button
            className="am-setting-row"
            onClick={() => onNavigate?.("play")}
          >
            Play Bots
            <ChevronRight />
          </button>
          <button
            className="am-setting-row"
            onClick={() => onNavigate?.("local")}
          >
            Play in Person
            <ChevronRight />
          </button>
          <Toggle
            label="Always Promote to Queen"
            checked={prefs.autoQueen}
            onChange={(v) => set("autoQueen", v)}
          />
        </div>
      )}
      {screen === "puzzles" && (
        <div>
          <Select
            label="Difficulty"
            value={prefs.puzzleDifficulty || "standard"}
            onChange={(v) => set("puzzleDifficulty", v)}
            options={[
              ["standard", "Standard"],
              ["hard", "Hard"],
              ["extra-hard", "Extra Hard"],
            ]}
          />
          <Toggle
            label="Collect Puzzle Points"
            checked={prefs.puzzlePoints !== false}
            onChange={(v) => set("puzzlePoints", v)}
          />
          <Toggle
            label="Always Show Rating"
            checked={prefs.puzzleRating !== false}
            onChange={(v) => set("puzzleRating", v)}
          />
        </div>
      )}
      {screen === "connection" && (
        <div className="am-connection-settings">
          {mobileServer()?.offlineAvailable ? (
            <p>Stockfish 18 is built into this app. Bot play, analysis, and Game Review can run on this phone.</p>
          ) : (
            <p>For PC engine access, run <b>start-mobile.cmd</b> and enter the address and connection code on the same Wi-Fi.</p>
          )}
          <button
            className="am-primary"
            onClick={() =>
              isAndroid
                ? openMobileSettings()
                : setHealth({
                    ok: false,
                    message:
                      "Open the installed Android app to configure its PC connection.",
                  })
            }
          >
            {mobileServer()?.offlineAvailable ? "Engine options" : "Connect to PC"}
          </button>
          <button
            className="am-surface"
            onClick={testConnection}
            disabled={checking}
          >
            {checking ? "Checking…" : mobileServer()?.offlineAvailable ? "Test Engine" : "Test Connection"}
          </button>
          {health && (
            <p
              role="status"
              className={health.ok ? "connected" : "disconnected"}
            >
              {health.message}
            </p>
          )}
          {mobileServer()?.offlineAvailable && (
            <p>
              Stockfish 18 is available under the GPLv3.{" "}
              <a href="/chess-local/stockfish/COPYING.txt">License</a>{" · "}
              <a href="https://github.com/official-stockfish/Stockfish/releases/download/sf_18/stockfish-android-armv8.tar">Corresponding source</a>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
