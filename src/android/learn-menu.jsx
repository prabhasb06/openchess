import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { MobileColorIcon } from "./chrome";
import "./learn-menu.css";

// Action order and dock placement from the authorized build280100 Learn-menu
// capture. No transition duration or online lesson state is inferred.
export function MobileLearnMenu({
  onClose,
  onNext,
  onCoach,
  onOpening,
  onLibrary,
  disabled = false,
}) {
  const panel = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.querySelector("button")?.focus({ preventScroll: true });
    const back = (event) => {
      if (!event.defaultPrevented) {
        event.preventDefault();
        onClose();
      }
    };
    const key = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key === "Tab") {
        const controls = [...panel.current.querySelectorAll("button")].filter(
          (n) => !n.disabled,
        );
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus({ preventScroll: true });
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus({ preventScroll: true });
        }
      }
    };
    window.addEventListener("chess-native-back", back);
    document.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("chess-native-back", back);
      document.removeEventListener("keydown", key);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [onClose]);
  return (
    <section
      className="am-learn-options"
      role="dialog"
      aria-modal="true"
      aria-label="Learn"
      ref={panel}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="am-learn-options-actions">
        <button onClick={onCoach}>
          <MobileColorIcon name="coach-danny" />
          Play Coach
        </button>
        <button onClick={onOpening}>
          <MobileColorIcon name="play-white" />
          Learn an Opening
        </button>
        <button onClick={onLibrary}>
          <MobileColorIcon name="lesson-library" />
          Lesson Library
        </button>
      </div>
      <div className="am-training-dock am-learn-options-dock">
        <button
          className="am-training-menu-button"
          onClick={onClose}
          aria-label="Close Learn"
        >
          <X />
        </button>
        <button className="am-primary" disabled={disabled} onClick={onNext}>
          Next Lesson
        </button>
      </div>
    </section>
  );
}
