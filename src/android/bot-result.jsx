import { BookOpen, Share2, TriangleAlert } from "lucide-react";
import { localCoach as coach } from "./local-art";
import React, { useEffect, useState } from "react";
import { Volume2, VolumeX, X } from "lucide-react";
import { useResultAnalysis } from "./local-result";
import "./bot-result.css";

export function BotResult({ game: c, quickAnalysis, onClose, onShare, onReview, onNewGame }) {
  const side = c.side || "w";
  const name = c.bot?.name || "Computer";
  const token = c.game.getHeaders().Result;
  const draw = token === "1/2-1/2";
  const won = token === (side === "w" ? "1-0" : "0-1");
  const title = draw ? "Draw" : won ? `You Beat ${name}!` : `${name} Won`;
  const reason = c.result.replace(/^(?:White|Black) wins?\s*|^Draw(?: —)?\s*/i, "");
  const subtitle = reason.replace(/\b\w/g, (initial, offset) => offset === 0 && /^(by|on)\b/i.test(reason)
    ? initial.toLowerCase()
    : initial.toUpperCase());
  const { report, status, abort } = useResultAnalysis(c.pgn || c.game.pgn(), quickAnalysis);
  const [speaking, setSpeaking] = useState(false);
  const [audioNotice, setAudioNotice] = useState("");
  const synth = window.speechSynthesis;
  const blunders = report ? report.counts[side].Blunder : "—";
  const tip = status === "running"
    ? "One moment while I break your game down…"
    : !c.moves.length
      ? "Play a few moves to get feedback in Game Review."
      : draw || won
        ? "Let’s look at the game and see what you can learn."
        : "Review the turning points to find a stronger plan for the next game.";

  useEffect(() => () => synth?.cancel(), [synth]);
  function readTip() {
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    const voice = synth?.getVoices().find((candidate) => candidate.localService && /^en\b/i.test(candidate.lang));
    if (!voice || !window.SpeechSynthesisUtterance) {
      setAudioNotice("Coach audio is unavailable without an offline English voice.");
      return;
    }
    const speech = new SpeechSynthesisUtterance(tip);
    speech.voice = voice;
    speech.onend = speech.onerror = () => setSpeaking(false);
    setAudioNotice("");
    setSpeaking(true);
    synth.speak(speech);
  }
  function act(action, ...args) {
    abort();
    action?.(...args);
  }
  return (
    <>
      <header className="am-bot-result-heading">
        <button aria-label="Share game PGN" onClick={onShare}>
          <Share2 />
        </button>
        <button aria-label={speaking ? "Stop coach audio" : "Read coach tip aloud"} onClick={readTip}>
          {speaking ? <VolumeX /> : <Volume2 />}
        </button>
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        <button aria-label="Close game result" onClick={() => act(onClose)}><X /></button>
      </header>
      <div className="am-bot-result-content">
        <div className="am-bot-result-coach">
          <img src={coach} alt="" />
          <p role="status">{tip}</p>
        </div>
        {audioNotice && <p className="am-bot-result-note" role="status">{audioNotice}</p>}
        <div className="am-bot-result-counts" aria-label="Move classifications">
          {[
            { label: "Book", Icon: BookOpen, color: "#d8a67e", value: "—", description: "Book move count unavailable" },
            { label: "Miss", Icon: X, color: "#ff7769", value: "—", description: "Miss count unavailable" },
            { label: "Blunder", Icon: TriangleAlert, color: "#fa412d", value: blunders,
              description: report ? `Estimated blunders: ${blunders}` : "Blunder count unavailable" },
          ].map(({ label, Icon, color, value, description }) => (
            <div key={label} style={{ color }}>
              <b aria-label={description}><Icon aria-hidden="true" />{value}</b>
              <span>{label}</span>
            </div>
          ))}
        </div>
        <button className="am-bot-result-review" disabled={!c.moves.length} onClick={() => act(onReview)}>
          <span aria-hidden="true">★</span> Game Review
        </button>
        <div className="am-bot-result-actions">
          <button onClick={() => act(onNewGame, { rematch: false })}>New Bot</button>
          <button onClick={() => act(onNewGame, { rematch: true })}>Rematch</button>
        </div>
      </div>
    </>
  );
}
