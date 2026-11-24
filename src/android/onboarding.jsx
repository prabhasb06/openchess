import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, Mail, X } from "lucide-react";
import { localLogo, localPiece } from "./local-art";
import "./chrome.css";
import "./onboarding.css";

export function MobileOnboarding({
  onFinish,
  onNavigateOnline,
  prefs = {},
  phoneEnabled = false,
}) {
  const [remote, setRemote] = useState(""),
    [error, setError] = useState("");
  const [reduced, setReduced] = useState(
    () =>
      globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
      false,
  );
  const finishing = useRef(false),
    modal = useRef(null),
    lastFocus = useRef(null);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!remote) return;
    lastFocus.current = document.activeElement;
    modal.current?.querySelector("button")?.focus({ preventScroll: true });
    const close = () => setRemote("");
    const back = (event) => {
      if (!event.defaultPrevented) {
        event.preventDefault();
        close();
      }
    };
    const key = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
      if (event.key === "Tab") {
        const controls = [
          ...modal.current.querySelectorAll("button,a[href]"),
        ].filter((n) => !n.disabled);
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus({ preventScroll: true });
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus({ preventScroll: true });
        }
      }
    };
    window.addEventListener("chess-native-back", back);
    document.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("chess-native-back", back);
      document.removeEventListener("keydown", key);
      if (lastFocus.current?.isConnected)
        lastFocus.current.focus({ preventScroll: true });
    };
  }, [remote]);
  function account(method) {
    if (onNavigateOnline) onNavigateOnline(method);
    else setRemote(method);
  }
  function guest() {
    if (finishing.current) return;
    finishing.current = true;
    try {
      onFinish?.({ mode: "guest", name: "Guest" });
    } catch {
      finishing.current = false;
      setError("Could not open local play. Please try again.");
    }
  }
  const staticHero = reduced || prefs.themeAnimations === false;
  return (
    <section className="am-onboarding" aria-label="Welcome to Chess Local">
      <header className="am-onboarding-header">
        <img src={localLogo} alt="Chess Local" />
        <button onClick={() => account("Log In")}>Log In</button>
      </header>
      <div className="am-onboarding-introduction">
        <h1>
          Make your next move
        </h1>
        <div
          className={`am-onboarding-hero${staticHero ? " is-static" : ""}`}
          aria-hidden="true"
        >
          <img className="am-onboarding-pawn" src={localPiece("wn")} alt="" />
        </div>
      </div>
      <div className="am-onboarding-methods">
        {phoneEnabled && (
          <button
            className="am-onboarding-phone"
            onClick={() => account("Continue with Phone")}
          >
            Continue with Phone
          </button>
        )}
        <button
          className="am-onboarding-google"
          onClick={() => account("Continue with Google")}
        >
          <span>Continue with Google</span>
        </button>
        <div className="am-onboarding-or" aria-hidden="true">
          <span />
          or
          <span />
        </div>
        <button
          className="am-onboarding-email"
          onClick={() => account("Continue with Email")}
        >
          <Mail aria-hidden="true" />
          <span>Continue with Email</span>
        </button>
        <button className="am-onboarding-guest" onClick={guest}>
          Play as Guest
        </button>
        <p className="am-onboarding-terms">Guest games and practice progress are saved on this device.</p>
        {error && (
          <p role="alert" className="am-onboarding-error">
            {error}
          </p>
        )}
      </div>
      {remote && (
        <div
          className="am-onboarding-availability"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setRemote("");
          }}
        >
          <section
            className="am-onboarding-dialog"
            ref={modal}
            role="dialog"
            aria-modal="true"
            aria-label={remote}
          >
            <button
              aria-label="Close availability message"
              className="am-onboarding-close"
              onClick={() => setRemote("")}
            >
              <X />
            </button>
            <img src={localLogo} alt="" />
            <h2>{remote}</h2>
            <h3>Coming Soon</h3>
            <p>
              Online account services are not connected yet. You can play
              locally, solve puzzles and learn as a guest.
            </p>
            <button className="am-primary" onClick={guest}>
              Play as Guest
            </button>
            <button
              className="am-onboarding-dialog-back"
              onClick={() => setRemote("")}
            >
              <ArrowLeft />
              Back
            </button>
          </section>
        </div>
      )}
    </section>
  );
}
