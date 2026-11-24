import React, { useState } from "react";
import {
  ArrowLeft,
  Bell,
  ChevronDown,
  Settings,
  Flame,
  Search,
  QrCode,
} from "lucide-react";
import { Activity, BadgeHelp, BookOpen, Bot, Calendar, Clock, Gem, Grid2X2, House, Mail, Menu, Monitor, Puzzle, Smartphone, Sparkles, Trophy, Users, Zap } from "lucide-react";
import { localLogo } from "./local-art";
import "./chrome.css";

const icons = {
  "time-rapid": Clock, "time-bullet": Zap, "time-blitz": Zap, "time-daily": Calendar,
  "calendar-dailypuzzle": Calendar, "play-white": Grid2X2, lessons: BookOpen,
  "lesson-library": BookOpen, "puzzle-piece": Puzzle, "puzzle-tier-pawn": Puzzle,
  "puzzle-tier-badge": Puzzle, "device-bot": Bot, "coach-danny": Sparkles,
  "commerce-diamond": Gem, settings: Settings, theme: Grid2X2, stats: Activity,
  awards: Trophy, messages: Mail, support: BadgeHelp, "custom-game": Grid2X2,
  "in-person": Smartphone, friends: Users, home: House, puzzles: Puzzle,
  learn: BookOpen, watch: Monitor, more: Menu,
};
export function MobileColorIcon({ name, className = "", ...props }) {
  const Icon = icons[name] || Grid2X2;
  return <Icon className={`am-color-icon ${className}`} data-icon={name} aria-hidden="true" {...props} />;
}
export function MobileNavIcon({ name }) {
  const Icon = icons[name] || Grid2X2;
  return <Icon className="am-nav-glyph" aria-hidden="true" />;
}

export function MobileHeader({ title, onBack, onSettings, icon }) {
  return (
    <header className="am-header">
      {onBack ? (
        <button className="am-icon-button" onClick={onBack} aria-label="Back">
          <ArrowLeft />
        </button>
      ) : (
        <span className="am-header-spacer" />
      )}
      <h1>
        {typeof icon === "string" ? <MobileColorIcon name={icon} /> : icon}
        {title}
      </h1>
      {onSettings ? (
        <button
          className="am-icon-button"
          onClick={onSettings}
          aria-label="Settings"
        >
          <Settings />
        </button>
      ) : (
        <span className="am-header-spacer" />
      )}
    </header>
  );
}

export function MobileTabs({ active, onNavigate }) {
  const items = [
    ["home", "Home", "home"],
    ["puzzles", "Puzzles", "puzzles"],
    ["lessons", "Learn", "learn"],
    ["watch", "Watch", "watch"],
    ["more", "More", "more"],
  ];
  return (
    <nav className="am-tabs" aria-label="Main navigation">
      {items.map(([route, label, icon]) => (
        <button
          key={route}
          className={active === route ? "is-active" : ""}
          aria-current={active === route ? "page" : undefined}
          onClick={() => onNavigate(route)}
        >
          <MobileNavIcon name={icon} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

const number = (value) =>
  Number.isFinite(value) ? value.toLocaleString() : "—";
export function MobileHome({ onNavigate, stats = {}, prefs = {} }) {
  const solved = Math.max(0, Number(stats.solved) || 0),
    streak = Math.max(0, Number(stats.streak) || 0);
  const progress = Math.max(0, Math.min(1, Number(stats.puzzleProgress) || 0));
  const ratings = [
    ["Rapid", stats.rapid, "time-rapid"],
    ["Bullet", stats.bullet, "time-bullet"],
    ["Blitz", stats.blitz, "time-blitz"],
    ["Daily", stats.daily, "time-daily"],
  ];
  return (
    <section
      className={`am-home${prefs.homeClassic ? " am-home-classic" : ""}`}
      aria-label="Home"
    >
      <div className="am-home-topbar">
        <button
          className="am-profile-button"
          onClick={() => onNavigate("settings")}
          aria-label={`Profile for ${prefs.name || "Guest"}`}
        >
          <img src={localLogo} alt="" />
        </button>
        {prefs.homeStreak !== false && (
          <button
            className="am-streak-button"
            onClick={() => onNavigate("stats")}
            aria-label={`Learning streak: ${streak} days`}
          >
            <Flame fill="currentColor" />
            <strong>{streak}</strong>
          </button>
        )}
        <strong className="am-home-brand">Chess Local</strong>
        <div className="am-topbar-actions">
          <button
            className="am-icon-button"
            onClick={() => onNavigate("Membership")}
            aria-label="Membership"
          >
            <MobileColorIcon name="commerce-diamond" />
          </button>
          <button
            className="am-icon-button"
            onClick={() => onNavigate("Friends")}
            aria-label="Friends"
          >
            <MobileColorIcon name="friends" />
          </button>
          <button
            className="am-icon-button am-bell"
            onClick={() => onNavigate("Notifications")}
            aria-label="Notifications"
          >
            <Bell fill="#f6d64b" stroke="#e9b623" />
          </button>
        </div>
      </div>
      <div className="am-feature-carousel" aria-label="Training activities">
        <article
          className="am-puzzle-feature"
        >
          <MobileColorIcon
            className="am-feature-pawn"
            name="puzzle-tier-pawn"
          />
          <h2>
            <span className="am-puzzle-level">
              {Math.max(1, Number(stats.puzzleLevel) || 1)}
            </span>
            Puzzles
          </h2>
          <div className="am-puzzle-feature-bottom">
            <div className="am-puzzle-progress">
              <strong>{number(stats.puzzleRating ?? solved)}</strong>
              {prefs.homeStreak !== false && (
                <span className="am-orange-streak">
                  <Flame fill="currentColor" />
                  {streak}
                </span>
              )}
              <div className="am-progress-track">
                <i style={{ width: `${Math.max(6, progress * 100)}%` }} />
              </div>
            </div>
            <button
              className="am-primary"
              onClick={() => onNavigate("puzzles")}
            >
              Solve!
            </button>
          </div>
        </article>
        {prefs.homeDaily !== false && (
          <button
            className="am-daily-feature am-surface"
            onClick={() => onNavigate("daily")}
          >
            <MobileColorIcon name="calendar-dailypuzzle" />
            <strong>Daily Puzzle</strong>
            <span>A new challenge every day</span>
          </button>
        )}
      </div>
      {prefs.homeRecommended !== false && (
        <section className="am-home-section">
          <div className="am-section-title">
            <h2>Recommended Match</h2>
          </div>
          <button
            className="am-recommended-card am-surface"
            onClick={() => onNavigate(stats.recentGame ? "history" : "play")}
          >
            <div className="am-recommended-picture">
              <MobileColorIcon
                name={stats.recentGame ? "board-archive" : "device-bot"}
              />
            </div>
            <div>
              <strong>{stats.recentGame?.opponent || "Play a Bot"}</strong>
              <span>
                {stats.recentGame
                  ? "Review your recent game"
                  : "Choose your challenge"}
              </span>
              <small>{stats.recentGame ? "RECENT GAME" : "PRACTICE"}</small>
            </div>
            <span className="am-primary am-recommended-play">
              <MobileColorIcon
                name={stats.recentGame ? "magnifier-analysis" : "play-white"}
              />
            </span>
          </button>
        </section>
      )}
      <section className="am-home-section">
        <div className="am-section-title">
          <h2>Ratings</h2>
          <button onClick={() => onNavigate("stats")}>View All</button>
        </div>
        <div className="am-rating-carousel">
          {ratings.map(([name, value, icon]) => (
            <button
              className="am-rating-card am-surface"
              key={name}
              onClick={() => onNavigate("stats")}
            >
              <MobileColorIcon name={icon} />
              <strong>{number(value)}</strong>
              <span>{name}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="am-home-section">
        <div className="am-section-title">
          <h2>Friends</h2>
        </div>
        <div className="am-friends-carousel">
          <button
            className="am-friend-card am-surface"
            onClick={() => onNavigate("Friends")}
          >
            <Search />
            <strong>Find Friends</strong>
          </button>
          <button
            className="am-friend-card am-surface"
            onClick={() => onNavigate("friend")}
          >
            <MobileColorIcon name="play-white" />
            <strong>Play a Friend</strong>
          </button>
          <button
            className="am-friend-card am-surface"
            onClick={() => onNavigate("Invite Friends")}
          >
            <QrCode />
            <strong>Invite Friends</strong>
          </button>
        </div>
      </section>
      <div className="am-home-play-dock">
        <button className="am-primary" onClick={() => onNavigate("new-game")}>
          Play
        </button>
      </div>
    </section>
  );
}

export function MobilePlayMenu({ onNavigate, timeLabel = "10 min", onTime }) {
  const [expanded, setExpanded] = useState(false);
  const choices = [
    ["Tournaments", "Tournaments", "tournament-gold"],
    ["Play a Friend", "friend", "friends"],
    ["Play Bots", "play", "device-bot"],
    ["Play Coach", "coach", "coach-danny"],
  ];
  return (
    <section className="am-play-menu" aria-label="New game">
      <MobileHeader
        title="New Game"
        icon="play-white"
        onBack={() => onNavigate("home")}
      />
      <div className="am-play-menu-content">
        <button
          className="am-time-picker am-surface"
          onClick={onTime}
          aria-label={`Time control: ${timeLabel}`}
        >
          <MobileColorIcon
            name={
              /^(1|2)\b/.test(timeLabel)
                ? "time-bullet"
                : /^(3|5)\b/.test(timeLabel)
                  ? "time-blitz"
                  : "time-rapid"
            }
          />
          <strong>{timeLabel}</strong>
          <ChevronDown />
        </button>
        <button
          className="am-primary am-start-online"
          onClick={() => onNavigate("online")}
        >
          Start Game
        </button>
        <div className="am-play-choices">
          {choices.map(([label, route, icon]) => (
            <button
              className="am-surface"
              key={route}
              onClick={() => onNavigate(route)}
            >
              <MobileColorIcon name={icon} />
              <strong>{label}</strong>
            </button>
          ))}
        </div>
        <button
          className="am-play-more"
          aria-label={expanded ? "Fewer play options" : "More play options"}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronDown
            style={expanded ? { transform: "rotate(180deg)" } : undefined}
          />
        </button>
        {expanded && (
          <div className="am-play-choices am-expanded-play-choices">
            <button
              className="am-surface"
              onClick={() => onNavigate("custom-game")}
            >
              <MobileColorIcon name="custom-game" />
              <strong>Custom Game</strong>
            </button>
            <button
              className="am-surface"
              onClick={() => onNavigate("local-setup")}
            >
              <MobileColorIcon name="in-person" />
              <strong>Play in Person</strong>
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

export function MobileMore({ onNavigate }) {
  const rows = [
    ["Membership", "Membership", "commerce-diamond"],
    ["Profile", "profile", "profile"],
    ["Stats", "stats", "stats"],
    ["Theme", "appearance", "theme"],
    ["Awards", "Awards", "awards"],
    ["Friends", "Friends", "friends"],
    ["Messages", "Messages", "messages"],
    ["Settings", "settings", "settings"],
    ["Support", "Support", "support"],
  ];
  return (
    <section className="am-more-page" aria-label="More">
      <header className="am-more-brand">
        <MobileNavIcon name="home" />
        <span>
          Chess<small>.com</small>
        </span>
      </header>
      <button
        className="am-premium-banner"
        onClick={() => onNavigate("Membership")}
      >
        <MobileColorIcon name="commerce-diamond" />
        <span>
          <strong>Try Premium</strong>
          <small>Play your best chess!</small>
        </span>
      </button>
      <section className="am-more-account">
        <h2>Account</h2>
        <div className="am-more-rows">
          {rows.map(([label, route, icon]) => (
            <button key={route} onClick={() => onNavigate(route)}>
              {icon === "profile" ? (
                <span className="am-more-profile">
                  <img src={localLogo} alt="" />
                </span>
              ) : (
                <MobileColorIcon name={icon} />
              )}
              <strong>{label}</strong>
            </button>
          ))}
        </div>
      </section>
    </section>
  );
}
