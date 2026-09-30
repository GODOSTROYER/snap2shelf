"use client";

/**
 * The director's cut: a full-screen, keyboard-driven walkthrough of
 * Snap2Shelf for live judging and for recording the demo video.
 *
 *   → / Space / PageDown  next        ← / PageUp  back
 *   P  autoplay on/off                R  restart
 *   F  fullscreen                     N  presenter notes
 *   H  hide chrome (clean feed)       ?  shortcuts
 *   1–9, 0 = 10, two digits quickly = 11, 12
 *
 * Touch: tap the right two thirds for next, the left third for back, or
 * swipe. Phones get a touch bar under the stage (label, rail, hint); the
 * 1920×1080 artboard itself is unchanged.
 *
 * URL: /present?c=4 (start at chapter 4) &auto=1 (autoplay) &clean=1 (no chrome).
 */
import { ChevronLeft, ChevronRight, Keyboard, Maximize, Minimize, NotebookPen, Pause, Play } from "lucide-react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent, type PointerEvent } from "react";
import { CHAPTERS, chapterAssets, chapterAvailable } from "@/lib/present/chapters";
import type { PresentData } from "@/lib/present/data";
import { preloadImages, preloadVideo, preloadWhenIdle } from "@/lib/present/preload";
import { CHAPTER_VIEWS } from "./chapters";
import { Artboard, Backdrop } from "./stage";

export interface DeckProps {
  data: PresentData;
  initial?: { chapter?: number; auto?: boolean; clean?: boolean };
}

const KEYS: [string[], string][] = [
  [["→", "Space"], "Next chapter"],
  [["←"], "Previous chapter"],
  [["P"], "Autoplay on or off"],
  [["R"], "Restart from the top"],
  [["1–9", "0"], "Jump to a chapter (type 11, 12 quickly)"],
  [["F"], "Fullscreen"],
  [["N"], "Presenter notes"],
  [["H"], "Hide the chrome for recording"],
  [["?"], "This list"],
];

const noSubscribe = () => () => {};
/**
 * True once hydrated. Chapters render on the client only: they branch on
 * useReducedMotion(), which the server can't know, so rendering them in SSR
 * would mismatch for anyone with reduced motion on. Every chapter starts from
 * opacity 0 anyway, so nothing visible is lost.
 */
const useHydrated = () => useSyncExternalStore(noSubscribe, () => true, () => false);

/** Seconds since this chapter started (remounted per chapter). */
function ChapterClock() {
  const [s, setS] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setS((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="pz-num">{s}</span>;
}

export function Deck({ data, initial }: DeckProps) {
  const chapters = useMemo(() => CHAPTERS.filter((c) => chapterAvailable(c.id, data)), [data]);
  const count = chapters.length;
  const clamp = useCallback((i: number) => Math.min(count - 1, Math.max(0, i)), [count]);

  const [index, setIndex] = useState(() => Math.min(count - 1, Math.max(0, initial?.chapter ?? 0)));
  const [run, setRun] = useState(0);
  const [auto, setAuto] = useState(!!initial?.auto);
  const [notes, setNotes] = useState(false);
  const [clean, setClean] = useState(!!initial?.clean);
  const [help, setHelp] = useState(false);
  const [idle, setIdle] = useState(false);
  const [hint, setHint] = useState(!initial?.clean && !initial?.auto);
  const [full, setFull] = useState(false);

  const ch = chapters[index];
  const View = CHAPTER_VIEWS[ch.id];
  const hydrated = useHydrated();
  const seconds = ch.seconds(data);

  const go = useCallback(
    (i: number) => {
      setIndex(clamp(i));
      setRun((r) => r + 1);
      setHint(false);
    },
    [clamp],
  );
  const next = useCallback(() => {
    if (index < count - 1) go(index + 1);
    else setAuto(false);
  }, [index, count, go]);
  const prev = useCallback(() => go(index - 1), [index, go]);

  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);

  // auto-advance
  useEffect(() => {
    if (!auto) return;
    const id = window.setTimeout(next, seconds * 1000);
    return () => window.clearTimeout(id);
  }, [auto, index, run, seconds, next]);

  // keep ?c= in the address bar so a reload lands on the same chapter
  useEffect(() => {
    const u = new URL(window.location.href);
    u.searchParams.set("c", String(index + 1));
    window.history.replaceState(window.history.state, "", u);
  }, [index]);

  // warm the cache: this chapter, the next one, then everything else when idle
  useEffect(() => {
    preloadImages(chapterAssets(ch.id, data));
    const nxt = chapters[index + 1];
    if (nxt) preloadImages(chapterAssets(nxt.id, data));
    const reelAt = chapters.findIndex((c) => c.id === "reel");
    if (data.reel && reelAt >= 0 && index >= reelAt - 3) preloadVideo(data.reel.url);
  }, [ch.id, chapters, index, data]);
  useEffect(() => preloadWhenIdle(chapters.map((c) => chapterAssets(c.id, data))), [chapters, data]);

  useEffect(() => {
    const t = window.setTimeout(() => setHint(false), 6000);
    const onFs = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, []);

  // hide the cursor and controls when the mouse rests
  const idleTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const wake = () => {
      setIdle(false);
      window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => setIdle(true), 2500);
    };
    wake();
    window.addEventListener("mousemove", wake);
    window.addEventListener("pointerdown", wake);
    return () => {
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("pointerdown", wake);
      window.clearTimeout(idleTimer.current);
    };
  }, []);

  // keyboard
  const digits = useRef({ buf: "", timer: 0 });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      const k = e.key;
      let handled = true;
      if (k === "ArrowRight" || k === " " || k === "PageDown") next();
      else if (k === "ArrowLeft" || k === "PageUp" || k === "Backspace") prev();
      else if (k === "Home") go(0);
      else if (k === "End") go(count - 1);
      else if (k === "p" || k === "P") setAuto((a) => !a);
      else if (k === "r" || k === "R") go(0);
      else if (k === "f" || k === "F") toggleFull();
      else if (k === "n" || k === "N") setNotes((v) => !v);
      else if (k === "h" || k === "H") setClean((v) => !v);
      else if (k === "?" || k === "/") setHelp((v) => !v);
      else if (k === "Escape") {
        if (help) setHelp(false);
        else if (notes) setNotes(false);
        else handled = false;
      } else if (/^[0-9]$/.test(k)) {
        const d = digits.current;
        window.clearTimeout(d.timer);
        d.buf += k;
        const commit = () => {
          const v = Number(d.buf);
          d.buf = "";
          go(v === 0 ? 9 : v - 1);
        };
        const asTwo = Number(d.buf);
        if (d.buf.length >= 2) {
          if (asTwo >= 1 && asTwo <= count) commit();
          else {
            d.buf = k;
            d.timer = window.setTimeout(commit, 380);
          }
        } else if (d.buf === "1" && count > 10) d.timer = window.setTimeout(commit, 380);
        else commit();
      } else handled = false;
      if (handled) {
        e.preventDefault();
        setHint(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, go, count, toggleFull, help, notes]);

  const click = (fn: () => void) => (e: MouseEvent<HTMLButtonElement>) => {
    fn();
    e.currentTarget.blur(); // so Space keeps meaning "next", not "press this button again"
  };

  // touch: tap thirds or swipe (mouse clicks never navigate, so recording stays keyboard-driven)
  const touch = useRef<{ x: number; y: number; t: number; id: number } | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    touch.current = e.pointerType === "mouse" ? null : { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  };
  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    const s = touch.current;
    touch.current = null;
    if (!s || s.id !== e.pointerId) return;
    if ((e.target as HTMLElement | null)?.closest?.("button, a, video, [role='dialog'], .pz-notes")) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      if (dx < 0) next();
      else prev();
    } else if (Math.abs(dx) < 14 && Math.abs(dy) < 14 && performance.now() - s.t < 700) {
      if (e.clientX < window.innerWidth / 3) prev();
      else next();
    } else return;
    setHint(false);
  };

  const rail = (tips: boolean) =>
    chapters.map((c, i) => (
      <button
        key={c.id}
        type="button"
        className="pz-rail-seg"
        data-state={i < index ? "done" : i === index ? "current" : "todo"}
        aria-label={`Chapter ${i + 1}: ${c.title}`}
        aria-current={i === index ? "step" : undefined}
        onClick={click(() => go(i))}
      >
        {i === index && auto && (
          <motion.span key={`${run}-${auto}`} className="pz-rail-fill" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: seconds, ease: "linear" }} />
        )}
        {tips && (
          <span className="pz-rail-tip">
            {i + 1}. {c.title}
          </span>
        )}
      </button>
    ));

  const nextTitle = chapters[index + 1]?.title;

  return (
    <MotionConfig reducedMotion="user">
      <main
        className="pz-root"
        data-idle={idle && !help && !notes}
        data-clean={clean}
        aria-roledescription="presentation"
        aria-label="Snap2Shelf, director's cut"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          touch.current = null;
        }}
      >
        <Backdrop light={ch.light} />

        <Artboard label={`Chapter ${index + 1} of ${count}: ${ch.title}`}>
          <AnimatePresence initial={false}>
            <motion.section
              key={`${ch.id}-${run}`}
              className="pz-chapter"
              aria-roledescription="slide"
              aria-label={ch.title}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.35 } }}
              transition={{ duration: 0.5 }}
            >
              {hydrated && <View d={data} />}
            </motion.section>
          </AnimatePresence>

          {!clean && (
            <>
              <div className="pz-rail-label">
                <span style={{ color: "var(--pz-dim)" }}>
                  {index + 1}/{count}
                </span>
                <span style={{ marginLeft: 14 }}>{ch.title}</span>
              </div>
              <nav className="pz-rail" aria-label="Chapters">
                {rail(true)}
              </nav>
            </>
          )}
        </Artboard>

        {/* phones: the stage is ~20% size, so chrome moves under it at real size (hidden on laptops by CSS) */}
        {!clean && (
          <div className="pz-touchbar">
            <div className="pz-touchbar-label">
              <span style={{ color: "var(--pz-faint)" }}>
                {index + 1}/{count}
              </span>
              <span>{ch.title}</span>
            </div>
            <nav className="pz-touchbar-rail" aria-label="Chapters">
              {rail(false)}
            </nav>
            <p className="pz-touchbar-hint">Best viewed on a laptop — tap to advance</p>
          </div>
        )}

        <AnimatePresence>
          {hint && (
            <motion.div className="pz-hint" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: 1.2, duration: 0.5 }}>
              <span className="pz-hint-keys">
                <span className="pz-kbd">→</span> next
                <span className="pz-kbd" style={{ marginLeft: 10 }}>
                  P
                </span>
                autoplay
                <span className="pz-kbd" style={{ marginLeft: 10 }}>
                  ?
                </span>
                all shortcuts
              </span>
              <span className="pz-hint-touch">Best viewed on a laptop — tap to advance</span>
            </motion.div>
          )}
        </AnimatePresence>

        {!clean && (
          <div className="pz-controls" data-hidden={idle && !help} role="toolbar" aria-label="Presentation controls">
            <button type="button" className="pz-iconbtn" aria-label="Previous chapter" onClick={click(prev)} disabled={index === 0}>
              <ChevronLeft />
            </button>
            <button type="button" className="pz-iconbtn" aria-label={auto ? "Pause autoplay" : "Start autoplay"} aria-pressed={auto} onClick={click(() => setAuto((a) => !a))}>
              {auto ? <Pause /> : <Play />}
            </button>
            <button type="button" className="pz-iconbtn" aria-label="Next chapter" onClick={click(next)} disabled={index === count - 1}>
              <ChevronRight />
            </button>
            <button type="button" className="pz-iconbtn" aria-label="Presenter notes" aria-pressed={notes} onClick={click(() => setNotes((v) => !v))}>
              <NotebookPen />
            </button>
            <button type="button" className="pz-iconbtn" aria-label="Keyboard shortcuts" aria-pressed={help} onClick={click(() => setHelp((v) => !v))}>
              <Keyboard />
            </button>
            <button type="button" className="pz-iconbtn" aria-label={full ? "Exit fullscreen" : "Fullscreen"} onClick={click(toggleFull)}>
              {full ? <Minimize /> : <Maximize />}
            </button>
          </div>
        )}

        <AnimatePresence>
          {notes && (
            <motion.aside className="pz-notes" aria-label="Presenter notes" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={{ duration: 0.25 }}>
              <div className="pz-notes-meta">
                <span>
                  {index + 1}/{count} {ch.title} · <ChapterClock key={`${index}-${run}`} />s of {Math.round(seconds)}s {auto ? "· autoplay" : ""}
                </span>
                <span>{nextTitle ? `Next: ${nextTitle}` : "Last chapter"}</span>
              </div>
              <div>{ch.cue(data)}</div>
            </motion.aside>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {help && (
            <motion.div className="pz-help" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setHelp(false)}>
              <div className="pz-help-card" onClick={(e) => e.stopPropagation()}>
                <h2>Keyboard shortcuts</h2>
                <dl>
                  {KEYS.map(([keys, what]) => (
                    <div key={what} style={{ display: "contents" }}>
                      <dt>
                        {keys.map((k) => (
                          <span key={k} className="pz-kbd">
                            {k}
                          </span>
                        ))}
                      </dt>
                      <dd>{what}</dd>
                    </div>
                  ))}
                </dl>
                <p className="pz-small" style={{ margin: "18px 0 0" }}>
                  For recording: /present?auto=1&amp;clean=1 plays every chapter with no chrome.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <p aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
          Chapter {index + 1} of {count}: {ch.title}
        </p>
      </main>
    </MotionConfig>
  );
}
