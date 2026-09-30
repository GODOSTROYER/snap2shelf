"""
Record the ~3-minute Snap2Shelf walkthrough from the live site, segment by
segment, and cut it into two 1920x1080 / 30 fps edits, reproducibly.

    npm run media:video                                       # re-record every segment except the live run, then cut and render
    python scripts/media/walkthrough.py --only studio,present # re-record just these; every other segment comes from its kept take
    python scripts/media/walkthrough.py --render-only         # no browser: re-cut and re-render the kept takes
    python scripts/media/walkthrough.py --only live --live    # the ONE real upload on production (spends ~0.35 transformation credits)
    python scripts/media/walkthrough.py --base http://localhost:3000 --only kit

Segments, in edit order (docs/VIDEO_SCRIPT.md, adapted to screen-only footage):

  title   /video/title                     the title card
  hook    /present?c=<One photo>&clean=1   the problem: one cluttered phone photo (a sample, labelled)
  studio  /studio?sample=shmessy1          the saved sample run, replayed: rail, QA catch -> fix -> approved, the kit deal
  reel    /present  Kit reel               the reel is one URL (cut in only while there is no live take: it holds the running time near 3:00)
  qa      /present  QA gate                Creative mode: the fast model's take rejected, the faithful one approved
  dna     /present  Scene DNA              anchor, light, text zone, the difference-mode pixel proof
  stages  /present  Every stage            the same cut-out on every library scene
  live    /studio   (Upload Widget)        ONE real upload on production: real time where things happen, the waits
                                           between sped up under a visible "Sped up xN" badge; the idle file-dialog wait
                                           before the photo is chosen is cut with a dissolve (it is outside photo -> ZIP)
  kit     /kit/shmessy1                    the kit page, its ZIP button, every format, the Readiness Score
  shelf   /shelf/demo-studio               the shop shelf
  xray    /present  It's a URL             the hero's delivery URL, colour-coded
  cost    /present  What it cost           0 new generation credits, the receipt
  arch    docs/architecture.svg            the README's architecture diagram (rendered locally, no request)
  outro   /video/outro                     the outro card

Groups for --only: present = hook,reel,qa,dna,stages,xray,cost · cards = title,outro · site = studio,kit,shelf.
Director's-cut chapters are found by TITLE (read from the deck's own chapter rail), so a renumbered deck still works.

Outputs (default: the "video" folder beside the repo, never inside it; --out to change):
  snap2shelf-walkthrough-picture.mp4     the edit with chapter captions and honesty labels only: record the voice-over on it
  snap2shelf-walkthrough-captioned.mp4   the same edit with short story captions, usable with no voice-over
  snap2shelf-walkthrough-captions.srt    the story captions as subtitles
  VO_CUE_SHEET.md                        timecode -> voice-over line, matched to THIS cut (regenerated every render)
  work/<segment>/                        each segment's take (screencast frames + the page's own timing marks)
  work/review/                           a contact sheet per segment (1 frame a second) and full-size stills, for checking

How it records: Chromium (headed by default, parked off-screen, because headed
compositing paints at 60+ fps where headless manages ~28) with the Chrome
DevTools screencast, every painted frame stamped with its paint time. Each
page is loaded once to warm the cache, then recorded: site pages from a fresh
navigation; deck chapters by stepping into them from a hidden neighbour (a deck
opened at ?c=N shows N already built); cards by replaying their build (R) in a
page that has painted once (a fresh load stalls on rastering the headline).
A take with a visible render stall mid-animation is retaken (--retakes).
Cuts follow marks the page itself reports (the pipeline rail's steps, the QA
story, the shelf's deal, the ZIP link), never guessed sleeps, and every output
frame is the one on screen at that instant, so nothing is time-stretched
except the live run's clearly labelled speed-up.

Running time: ~3:08 with the live run (a few holds tighten), ~2:59 without it
(the Kit reel chapter takes its place). The VO cue sheet is rebuilt to match.

Budget: every segment except `live` loads pre-rendered pages only (no
generation, AI Vision or Admin API calls, nothing is clicked that writes).
`live` uploads one photo through the public studio (no access code) and runs
the Exact pipeline once; it only records when you pass --live, and checks
/api/usage first. Every other run re-uses the kept live take.

Numbers in the captions come from lib/claims.ts (parsed at run time).

Needs: Python 3.10+, `pip install playwright pillow fonttools brotli`,
`python -m playwright install chromium`, and ffmpeg/ffprobe on PATH.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import bisect
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

try:
    from playwright.async_api import async_playwright, Page, TimeoutError as PwTimeout
except ImportError:  # pragma: no cover
    sys.exit("walkthrough.py needs Playwright for Python: pip install playwright && python -m playwright install chromium")
try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:  # pragma: no cover
    sys.exit("walkthrough.py needs Pillow: pip install pillow")

ROOT = Path(__file__).resolve().parents[2]
W, H = 1920, 1080
FPS = 30
XFADE = 0.45  # dissolve between segments, seconds
BASE_DEFAULT = "https://snap2shelf.vercel.app"
SITE_VIEWPORT = {"width": 1536, "height": 864}  # x 1.25 device scale = 1920x1080 frames: the script's "125% zoom" look
DECK_VIEWPORT = {"width": 1920, "height": 1080}  # the deck and the cards are 1920x1080 artboards: 1:1

PICTURE_NAME = "snap2shelf-walkthrough-picture.mp4"
CAPTIONED_NAME = "snap2shelf-walkthrough-captioned.mp4"
SRT_NAME = "snap2shelf-walkthrough-captions.srt"
CUE_NAME = "VO_CUE_SHEET.md"

ORDER = ["title", "hook", "studio", "reel", "qa", "dna", "stages", "live", "kit", "shelf", "xray", "cost", "arch", "outro"]
GROUPS = {
    "present": ["hook", "reel", "qa", "dna", "stages", "xray", "cost"],
    "cards": ["title", "outro"],
    "site": ["studio", "kit", "shelf"],
    "all": [s for s in ORDER if s != "live"],
}
# the deck chapter each present segment shows (matched against the rail's titles)
CHAPTER_OF = {"hook": "One photo", "reel": "Kit reel", "qa": "QA gate", "dna": "Scene DNA", "stages": "Every stage", "xray": "It's a URL", "cost": "What it cost"}
# how long each recorded page holds on screen in the edit (seconds, before dissolves); marks decide the rest
HOLD = {"title": 6.5, "hook": 12.0, "reel": 10.5, "qa": 15.0, "dna": 17.0, "stages": 10.5, "xray": 13.5, "cost": 13.0, "arch": 18.0, "outro": 9.5}
TIGHT_HOLD = {"hook": 11.0, "qa": 14.0, "cost": 12.5, "arch": 16.5}  # used when the live run is in the cut
STUDIO_TAIL = 8.3  # the dealt shelf holds this long after the last card lands
LIVE_TARGET_S = 24.0  # the live run's length on screen, speed-up included (the edit then runs ~3:12 without the reel)

# Brand tokens (app/globals.css)
MARIGOLD = (245, 165, 36)
MARIGOLD_HI = (255, 196, 92)
PAPER = (244, 239, 231)
DIM = (200, 190, 176)
INK = (14, 12, 10)


try:  # Windows consoles default to cp1252; the log prints arrows and dashes
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
except Exception:
    pass


def log(msg: str) -> None:
    print(f"[video] {msg}", flush=True)


# ─── Claims (lib/claims.ts is the one source of truth for numbers) ───────────


@dataclass
class Claims:
    range_s: tuple[int, int]
    photo_to_kit: str  # "about a minute"
    credits_saved: str  # "0 new generation credits — the scene is reused from the library"
    photoshoot_inr: int
    sample_label: str


def load_claims() -> Claims:
    src = (ROOT / "lib" / "claims.ts").read_text(encoding="utf-8")

    def grab(pattern: str) -> str:
        m = re.search(pattern, src)
        if not m:
            raise RuntimeError(f"lib/claims.ts no longer matches /{pattern}/: update walkthrough.py's load_claims()")
        return m.group(1)

    lo, hi = grab(r"MEASURED_PHOTO_TO_ZIP_RANGE_S\s*=\s*\[(\d+\s*,\s*\d+)\]").split(",")
    return Claims(
        range_s=(int(lo), int(hi)),
        photo_to_kit=grab(r'PHOTO_TO_KIT_COPY\s*=\s*"([^"]+)"'),
        credits_saved=grab(r'CREDITS_SAVED_COPY\s*=\s*"([^"]+)"'),
        photoshoot_inr=int(grab(r"PHOTOSHOOT_INR_ESTIMATE\s*=\s*(\d+)")),
        sample_label=grab(r'SAMPLE_PHOTO_LABEL\s*=\s*"([^"]+)"'),
    )


# ─── In-page scripts ─────────────────────────────────────────────────────────

# Runs in every document before the app's own scripts. Records, on the page's
# wall clock (epoch ms, the clock the screencast stamps frames with), the first
# time each state is on screen.
MARKS_JS = r"""
(() => {
  if (window.__s2sMarks) return;
  const marks = (window.__s2sMarks = {});
  const info = (window.__s2sInfo = {});
  const mark = (k) => { if (!(k in marks)) marks[k] = performance.timeOrigin + performance.now(); };
  let lastText = 0;
  const tick = () => {
    try {
      if (document.querySelector('h1')) mark('painted');
      if (document.querySelector('section.pz-chapter')) mark('mount');
      if (document.querySelector('.pz-video-root h1')) mark('build');
      const rail = document.querySelector('ol[aria-label="Progress"]');
      if (rail && rail.getBoundingClientRect().height > 0) {
        mark('rail');
        Array.from(rail.querySelectorAll(':scope > li')).forEach((li, i) => {
          if (li.getAttribute('aria-current') === 'step') mark('step' + i);
          if (/:\s*done\s*$/.test(li.textContent || '')) mark('done' + i);
        });
        if (!('photo_sharp' in marks)) {
          const big = Array.from(document.images).filter((im) => im.complete && im.naturalWidth && im.getBoundingClientRect().width > 300);
          const sharp = big.some((im) => {
            for (let k = 0, e = im; e && k < 4; k++, e = e.parentElement) {
              const cs = getComputedStyle(e);
              const blur = /blur\(([\d.]+)px\)/.exec(cs.filter);
              if ((blur && parseFloat(blur[1]) > 0.3) || parseFloat(cs.opacity) < 0.98) return false;
            }
            return true;
          });
          if (sharp) mark('photo_sharp');
        }
      }
      const now = performance.now();
      if (now - lastText > 90 && document.body) {
        lastText = now;
        const t = document.body.innerText || '';
        if (/QA caught/i.test(t)) mark('qa_caught');
        if (/Auto-fixed/i.test(t)) mark('qa_fixed');
        const alert = document.querySelector('main [role="alert"]');
        if (alert && alert.getBoundingClientRect().height > 0) { mark('alert'); info.alert = (alert.innerText || '').slice(0, 400); }
      }
      const kit = document.querySelector('section[data-kit]');
      if (kit) {
        mark('kit');
        const top = kit.getBoundingClientRect().top;
        if (top > -innerHeight * 0.3 && top < innerHeight * 0.36) mark('shelf_in_view');
        const cards = Array.from(kit.querySelectorAll('[data-card]'));
        if (cards.length && 'kit' in marks) {
          const hidden = cards.some((c) => getComputedStyle(c).opacity !== '1');
          if (hidden) mark('deal_start');
          else if ('deal_start' in marks) mark('dealt');
        }
        const zip = Array.from(kit.querySelectorAll('a')).find((a) => /\(\.zip\)/.test(a.textContent || ''));
        if (zip) { mark('zip_ready'); info.zipLabel = zip.textContent.trim(); }
      }
    } catch (e) { /* never break the page */ }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
"""

# A visible pointer (the screencast has no OS cursor). CSS px, eased moves, a click ring.
CURSOR_JS = r"""
(() => {
  if (document.getElementById('__s2s_cursor')) return;
  const c = document.createElement('div');
  c.id = '__s2s_cursor';
  c.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M4 2.5v17.2l4.6-4.2 2.9 6.6 3-1.3-2.9-6.5 6.3-.3z" fill="#f4efe7" stroke="#0e0c0a" stroke-width="1.4" stroke-linejoin="round"/></svg><span></span>';
  c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(' + Math.round(innerWidth * 0.62) + 'px,' + Math.round(innerHeight * 0.7) + 'px);transition:transform 800ms cubic-bezier(.3,.7,.2,1),opacity 250ms;opacity:0;filter:drop-shadow(0 2px 3px rgb(0 0 0/.6))';
  const ring = c.querySelector('span');
  ring.style.cssText = 'position:absolute;left:-14px;top:-14px;width:28px;height:28px;border-radius:50%;border:3px solid #f5a524;opacity:0;transform:scale(.4);transition:transform 380ms ease-out,opacity 380ms ease-out';
  document.documentElement.appendChild(c);
  window.__s2sCursor = {
    show: () => { c.style.opacity = '1'; },
    moveTo: (x, y) => { c.style.transform = `translate(${x}px,${y}px)`; },
    click: () => { ring.style.transition = 'none'; ring.style.opacity = '1'; ring.style.transform = 'scale(.4)'; void ring.offsetWidth; ring.style.transition = 'transform 380ms ease-out,opacity 380ms ease-out'; ring.style.transform = 'scale(1.6)'; ring.style.opacity = '0'; },
    hide: () => { c.style.opacity = '0'; },
  };
})();
"""

# Resolves once every <img> that intersects the viewport has loaded and decoded.
DECODE_JS = r"""
async () => {
  const vis = Array.from(document.images).filter((i) => {
    const r = i.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  });
  await Promise.all(vis.map((i) => (i.complete && i.naturalWidth ? i.decode() : new Promise((ok) => { i.addEventListener('load', ok, { once: true }); i.addEventListener('error', ok, { once: true }); })).catch(() => {})));
  return vis.filter((i) => i.complete && i.naturalWidth > 0).length + '/' + vis.length;
}
"""

# An eased scroll the camera can follow (smooth-scroll's own speed varies by distance).
SCROLL_JS = r"""
async ([y, ms]) => {
  const from = window.scrollY;
  const to = Math.max(0, Math.min(y, document.documentElement.scrollHeight - innerHeight));
  const t0 = performance.now();
  await new Promise((done) => {
    const step = (t) => {
      const u = Math.min(1, (t - t0) / ms);
      const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      window.scrollTo(0, from + (to - from) * e);
      if (u < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
  return window.scrollY;
}
"""

# Frame the shop so the title and all four tiles sit in view (layout positions: the entrance is still moving things).
SHOP_FRAME_JS = r"""
() => {
  const abs = (e) => { let y = 0; for (; e; e = e.offsetParent) y += e.offsetTop; return y; };
  const h1 = document.querySelector('h1');
  const imgs = Array.from(document.images).filter((i) => i.offsetWidth > 150);
  if (!h1 || !imgs.length) return 0;
  const bottom = Math.max(...imgs.map((i) => abs(i) + i.offsetHeight));
  const y = Math.round(Math.max(0, Math.min(bottom - (innerHeight - 110), abs(h1) - 40)));
  window.scrollTo(0, y);
  return y;
}
"""

# Document y (CSS px) of the first element matching a selector, or of a heading with the given text.
ABS_Y_JS = r"""
([sel, text]) => {
  let el = null;
  if (sel) el = document.querySelector(sel);
  if (!el && text) el = Array.from(document.querySelectorAll('h1,h2,h3,p,span,section')).find((e) => (e.textContent || '').trim().startsWith(text));
  if (!el) return null;
  return Math.round(el.getBoundingClientRect().top + window.scrollY);
}
"""


# ─── Screencast recorder ─────────────────────────────────────────────────────


@dataclass
class Recorder:
    """Chrome DevTools screencast: every painted frame, as JPEG, with its paint time."""

    page: Page
    frames_dir: Path
    frames: list[tuple[float, str]] = field(default_factory=list)
    _cdp: object = None
    _n: int = 0
    _tasks: set = field(default_factory=set)

    restarts: list = field(default_factory=list)
    _last: float = 0.0
    _watch: object = None
    _running: bool = False

    async def start(self) -> None:
        """Start after a navigation has committed: a screencast running across a cross-document
        navigation can stall (its frame acks go stale). A watchdog restarts it after any silence,
        which on a static page just re-sends the same picture."""
        self.frames_dir.mkdir(parents=True, exist_ok=True)
        if self._cdp is None:
            self._cdp = await self.page.context.new_cdp_session(self.page)
            self._cdp.on("Page.screencastFrame", self._on_frame)
        await self._begin()
        self._running = True
        self._last = time.time()
        self._watch = asyncio.ensure_future(self._watchdog())

    async def _begin(self) -> None:
        await self._cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 92, "maxWidth": W, "maxHeight": H, "everyNthFrame": 1})

    async def _watchdog(self) -> None:
        while self._running:
            await asyncio.sleep(0.15)
            if self._running and time.time() - self._last > 0.5:
                self.restarts.append(time.time())
                try:
                    await self._cdp.send("Page.stopScreencast")
                    await self._begin()
                except Exception:
                    pass
                self._last = time.time()

    async def stop(self) -> None:
        self._running = False
        if self._watch is not None:
            await asyncio.gather(self._watch, return_exceptions=True)
            self._watch = None
        if self._cdp is not None:
            try:
                await self._cdp.send("Page.stopScreencast")
            except Exception:
                pass
            await asyncio.sleep(0.25)
            if self._tasks:
                await asyncio.gather(*self._tasks, return_exceptions=True)
            try:
                await self._cdp.detach()
            except Exception:
                pass
            self._cdp = None

    def _on_frame(self, params: dict) -> None:
        task = asyncio.ensure_future(self._handle(params))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _handle(self, params: dict) -> None:
        ts = params.get("metadata", {}).get("timestamp") or time.time()
        name = f"f{self._n:05d}.jpg"
        self._n += 1
        (self.frames_dir / name).write_bytes(base64.b64decode(params["data"]))
        self.frames.append((float(ts), f"frames/{name}"))
        self._last = time.time()
        try:
            await self._cdp.send("Page.screencastFrameAck", {"sessionId": params["sessionId"]})
        except Exception:
            pass


async def marks_of(page: Page) -> dict[str, float]:
    m = await page.evaluate("() => window.__s2sMarks || {}")
    return {k: v / 1000.0 for k, v in m.items()}


async def wait_mark(page: Page, key: str, timeout_s: float) -> bool:
    try:
        await page.wait_for_function(f"() => window.__s2sMarks && '{key}' in window.__s2sMarks", timeout=timeout_s * 1000)
        return True
    except PwTimeout:
        return False


async def decoded(page: Page, timeout_s: float = 20) -> str:
    try:
        return await asyncio.wait_for(page.evaluate(DECODE_JS), timeout_s)
    except asyncio.TimeoutError:
        return "timeout"


async def settle(page: Page, timeout_ms: int = 15000) -> None:
    try:
        await page.wait_for_load_state("networkidle", timeout=timeout_ms)
    except PwTimeout:
        pass


async def scroll_to(page: Page, y: float, ms: int) -> float:
    return await page.evaluate(SCROLL_JS, [y, ms])


class Cursor:
    """The injected pointer: moves are CSS transitions (800 ms), so callers sleep to let them land."""

    def __init__(self, page: Page):
        self.page = page

    async def show(self) -> None:
        await self.page.evaluate(CURSOR_JS)
        await self.page.evaluate("() => window.__s2sCursor.show()")

    async def move(self, x: float, y: float, wait: float = 0.85) -> None:
        await self.page.evaluate(f"() => window.__s2sCursor && window.__s2sCursor.moveTo({x - 4:.0f}, {y - 3:.0f})")
        await self.page.mouse.move(x, y, steps=6)  # real hover states follow the drawn pointer
        await asyncio.sleep(wait)

    async def ring(self) -> None:
        await self.page.evaluate("() => window.__s2sCursor && window.__s2sCursor.click()")

    async def hide(self) -> None:
        await self.page.evaluate("() => window.__s2sCursor && window.__s2sCursor.hide()")


# ─── Takes ───────────────────────────────────────────────────────────────────


@dataclass
class Take:
    name: str
    dir: Path
    frames: list[tuple[float, str]]
    marks: dict[str, float]
    t0: float
    meta: dict = field(default_factory=dict)

    def path(self, rel: str) -> Path:
        return self.dir / rel

    def save(self) -> None:
        data = {"name": self.name, "t0": self.t0, "marks": self.marks, "meta": self.meta, "frames": self.frames}
        (self.dir / "take.json").write_text(json.dumps(data, indent=0), encoding="utf-8")

    @staticmethod
    def load(d: Path) -> "Take":
        data = json.loads((d / "take.json").read_text(encoding="utf-8"))
        return Take(data["name"], d, [(float(a), b) for a, b in data["frames"]], data["marks"], data["t0"], data.get("meta", {}))

    def stats(self) -> str:
        ts = [f[0] for f in self.frames]
        if len(ts) < 2:
            return f"{len(ts)} frame(s)"
        gaps = [b - a for a, b in zip(ts, ts[1:])]
        span = ts[-1] - ts[0]
        return f"{len(ts)} frames over {span:.1f} s ({len(ts) / max(span, 1e-6):.0f} fps avg, {sum(g > 0.1 for g in gaps)} gaps >100 ms)"


class Env:
    """One browser, two contexts: the deck/cards at 1920x1080 x1, the site at 1536x864 x1.25."""

    def __init__(self, pw, base: str, headed: bool, work: Path):
        self.pw = pw
        self.base = base.rstrip("/")
        self.headed = headed
        self.work = work
        self.browser = None
        self.ctx: dict[str, object] = {}
        self.pages: dict[str, Page] = {}
        self.chapters: dict[str, int] | None = None
        self.api_calls: dict[str, int] = {}

    async def open(self) -> None:
        args = [
            "--hide-scrollbars",
            "--disable-lcd-text",
            "--force-color-profile=srgb",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
            "--disable-background-timer-throttling",
            "--autoplay-policy=no-user-gesture-required",
        ]
        if self.headed:
            args.append("--window-position=-10000,-10000")  # parked off-screen: it paints, nobody sees it
        self.browser = await self.pw.chromium.launch(headless=not self.headed, args=args)
        for kind, vp, scale in (("deck", DECK_VIEWPORT, 1), ("site", SITE_VIEWPORT, 1.25)):
            ctx = await self.browser.new_context(viewport=vp, device_scale_factor=scale, color_scheme="dark", reduced_motion="no-preference", locale="en-IN")
            await ctx.add_init_script(MARKS_JS)
            self.ctx[kind] = ctx
            page = await ctx.new_page()
            page.set_default_timeout(60000)
            page.on("request", self._on_request)
            self.pages[kind] = page

    def _on_request(self, req) -> None:
        path = req.url.split("?", 1)[0]
        if "/api/" in path and self.base.split("//", 1)[-1] in path:
            key = f"{req.method} {path[path.index('/api/'):]}"
            self.api_calls[key] = self.api_calls.get(key, 0) + 1

    async def close(self) -> None:
        if self.browser:
            await self.browser.close()

    def url(self, path: str) -> str:
        return self.base + path

    async def chapter_index(self, title: str) -> int:
        """1-based ?c= of a deck chapter, read from the deck's own rail (chapters with missing data are skipped and renumber the rest)."""
        if self.chapters is None:
            page = self.pages["deck"]
            await page.goto(self.url("/present?c=1"), wait_until="load")
            await page.wait_for_selector("nav.pz-rail button", timeout=30000)
            labels = await page.evaluate("() => Array.from(document.querySelectorAll('nav.pz-rail button')).map((b) => b.getAttribute('aria-label'))")
            self.chapters = {}
            for lab in labels:
                m = re.match(r"Chapter (\d+): (.+)$", lab or "")
                if m:
                    self.chapters[norm(m.group(2))] = int(m.group(1))
            log(f"deck chapters: {', '.join(f'{v} {k}' for k, v in sorted(self.chapters.items(), key=lambda kv: kv[1]))}")
        key = norm(title)
        if key not in self.chapters:
            raise RuntimeError(f"the deck has no chapter titled '{title}' (it has: {', '.join(self.chapters)})")
        return self.chapters[key]


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace("\u2019", "'")).strip().lower()


# ─── Hitches ─────────────────────────────────────────────────────────────────


def used_window(t: Take) -> tuple[float, float]:
    """The stretch of a take the edit uses (roughly), where a stall would show."""
    m = t.marks
    first, last = (t.frames[0][0], t.frames[-1][0]) if t.frames else (t.t0, t.t0)
    if t.name in HOLD and ("mount" in m or "build" in m):
        a = m.get("mount", m.get("build"))
        return a, a + HOLD[t.name]
    if t.name == "studio":
        return m.get("rail", first), m.get("dealt", last) + STUDIO_TAIL
    return m.get("ready", first), m.get("end", last)


def hitches(t: Take) -> list[tuple[float, float, float]]:
    """Visible stalls: a paint gap after which the picture jumps much further than it moves frame to frame
    (a static stretch re-sent by the watchdog is not a stall). Returns (seconds into the take, gap, jump)."""
    from PIL import ImageChops, ImageStat

    a, b = used_window(t)
    cache: dict[str, Image.Image] = {}

    def small(rel: str) -> Image.Image:
        if rel not in cache:
            cache[rel] = Image.open(t.path(rel)).convert("L").resize((320, 180))
        return cache[rel]

    def diff(x: str, y: str) -> float:
        return ImageStat.Stat(ImageChops.difference(small(x), small(y))).mean[0]

    fr = t.frames
    out = []
    for i in range(2, len(fr) - 2):
        gap = fr[i][0] - fr[i - 1][0]
        if gap > 0.12 and a <= fr[i - 1][0] <= b:
            jump = diff(fr[i - 1][1], fr[i][1])
            typical = max(diff(fr[i - 2][1], fr[i - 1][1]), diff(fr[i][1], fr[i + 1][1]))
            if jump > 1.5 and jump > 3 * typical:
                out.append((round(fr[i - 1][0] - fr[0][0], 2), round(gap, 2), round(jump, 2)))
    return out


# ─── Segment recorders ───────────────────────────────────────────────────────


async def new_take(env: Env, name: str) -> tuple[Path, None]:
    """A fresh folder for a take; it replaces the kept one only once the recording succeeds."""
    tmp = env.work / f"{name}.tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    return tmp, None


async def rec_card(env: Env, name: str, path: str) -> Take:
    """A title/outro card. Opened settled (?hold=1), then its build replayed with R: in a page that has
    already painted every layer once, the build runs without the first-raster stall a fresh load shows."""
    page = env.pages["deck"]
    url = env.url(path + "?hold=1")
    await page.goto(url, wait_until="load")
    await settle(page)
    await asyncio.sleep(2.0)
    log(f"{name}: warm ({await decoded(page)} images decoded)")
    await page.mouse.move(W - 2, H - 2)
    # mark the frame the settled card is swapped for the replay (its headline is a new node)
    await page.evaluate("""() => {
      const old = document.querySelector('.pz-video-root h1');
      const tick = () => {
        const now = document.querySelector('.pz-video-root h1');
        if (old && (!old.isConnected || now !== old)) { window.__s2sMarks.rebuild = performance.timeOrigin + performance.now(); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }""")
    tmp, _ = await new_take(env, name)
    rec = Recorder(page, tmp / "frames")
    t0 = time.time()
    await rec.start()
    await asyncio.sleep(0.6)
    press = time.time()
    await page.keyboard.press("r")
    await asyncio.sleep(HOLD[name] + 1.2)
    await rec.stop()
    m = await marks_of(page)
    m.update({"press": press, "build": m.get("rebuild", press + 0.1)})
    if "rebuild" not in m:
        log(f"WARNING {name}: never saw the replay remount; cutting 0.1 s after the key press")
    return Take(name, tmp, sorted(rec.frames), m, t0, {"url": env.url(path), "kind": "deck", "restarts": rec.restarts})


async def rec_title(env: Env) -> Take:
    return await rec_card(env, "title", "/video/title")


async def rec_outro(env: Env) -> Take:
    return await rec_card(env, "outro", "/video/outro")


def rec_chapter(name: str) -> Callable:
    """A director's-cut chapter, with its build. A deck opened at ?c=N shows chapter N already
    built (its first render has no entrance), so this opens a neighbouring chapter, hides it,
    and steps to N with the arrow key: chapter N then builds in over the bare backdrop."""

    async def rec(env: Env) -> Take:
        title = CHAPTER_OF[name]
        c = await env.chapter_index(title)
        n_chapters = len(env.chapters or {})
        nb, key = (c - 1, "ArrowRight") if c > 1 else (c + 1, "ArrowLeft")
        if nb > n_chapters:
            raise RuntimeError("the deck has a single chapter")
        page = env.pages["deck"]
        # warm: the chapter itself once (its images decode), then its neighbour, which preloads it again
        await page.goto(env.url(f"/present?c={c}&clean=1"), wait_until="load")
        await settle(page)
        await asyncio.sleep(1.5)
        log(f"{name}: warm ({await decoded(page)} images decoded)")
        url = env.url(f"/present?c={nb}&clean=1")
        await page.goto(url, wait_until="load")
        await settle(page)
        await asyncio.sleep(2.0)
        await decoded(page)
        await page.mouse.move(W - 2, H - 2)
        await page.evaluate("() => document.querySelectorAll('section.pz-chapter').forEach((s) => (s.style.visibility = 'hidden'))")
        await asyncio.sleep(0.4)
        tmp, _ = await new_take(env, name)
        rec = Recorder(page, tmp / "frames")
        t0 = time.time()
        await rec.start()
        await asyncio.sleep(0.6)
        press = time.time()
        await page.keyboard.press(key)
        try:
            await page.wait_for_selector(f'section.pz-chapter[aria-label="{title}"]', timeout=5000)
        except PwTimeout:
            log(f"WARNING {name}: the chapter '{title}' never mounted")
        mount = time.time()
        await asyncio.sleep(HOLD[name] + 1.2)
        await rec.stop()
        m = await marks_of(page)
        m.update({"press": press, "mount": mount})
        return Take(name, tmp, sorted(rec.frames), m, t0, {"url": env.url(f"/present?c={c}&clean=1"), "kind": "deck", "chapter": c, "restarts": rec.restarts})

    return rec


async def rec_studio(env: Env) -> Take:
    """The saved sample run, replayed from first paint to the dealt shelf (no API calls)."""
    page = env.pages["site"]
    url = env.url("/studio?sample=shmessy1")
    log("studio: warm-up replay")
    await page.goto(url, wait_until="load")
    if not await wait_mark(page, "dealt", 90):
        log("studio: warm-up never finished dealing (continuing)")
    await settle(page)
    await page.evaluate("() => { document.querySelectorAll('section[data-kit] img').forEach((i) => (i.loading = 'eager')); }")
    await settle(page)
    await asyncio.sleep(1.0)
    tmp, _ = await new_take(env, "studio")
    await page.goto("about:blank")
    rec = Recorder(page, tmp / "frames")
    t0 = time.time()
    await page.goto(url, wait_until="commit")
    await rec.start()
    if not await wait_mark(page, "dealt", 90):
        log("WARNING studio: no 'dealt' mark")
    await asyncio.sleep(STUDIO_TAIL + 1.2)  # the dealt shelf holds while the reel card plays
    await rec.stop()
    m = await marks_of(page)
    return Take("studio", tmp, sorted(rec.frames), m, t0, {"url": url, "kind": "site"})


async def rec_kit(env: Env) -> Take:
    """/kit/shmessy1: the hero and its ZIP button, then down through every format to the Readiness Score."""
    page = env.pages["site"]
    url = env.url("/kit/shmessy1")
    await page.goto(url, wait_until="load")
    await settle(page)
    # warm: walk the page so every lazy image and panel is fetched once
    total = await page.evaluate("() => document.documentElement.scrollHeight")
    for y in range(0, int(total) + 1, 500):
        await page.evaluate(f"() => window.scrollTo(0, {y})")
        await asyncio.sleep(0.25)
    await settle(page)
    await asyncio.sleep(1.0)
    tmp, _ = await new_take(env, "kit")
    await page.goto("about:blank")
    rec = Recorder(page, tmp / "frames")
    t0 = time.time()
    await page.goto(url, wait_until="commit")
    await rec.start()
    await page.wait_for_load_state("domcontentloaded")
    await wait_mark(page, "painted", 20)
    state = await decoded(page)
    ex: dict[str, float] = {"ready": time.time()}
    log(f"kit: images decoded {state}")
    cur = Cursor(page)
    await asyncio.sleep(1.0)
    zipbtn = page.locator("a", has_text="(.zip)").first
    if await zipbtn.count():
        box = await zipbtn.bounding_box()
        await cur.show()
        ex["cursor"] = time.time()
        await cur.move(box["x"] + box["width"] * 0.42, box["y"] + box["height"] * 0.55, wait=2.0)  # hovered, never clicked
        await cur.hide()
        await page.mouse.move(SITE_VIEWPORT["width"] - 40, SITE_VIEWPORT["height"] - 40)
    else:
        log("WARNING kit: no ZIP button on the kit page")
    await asyncio.sleep(0.3)
    # room below the last panel, so the camera can bring the Readiness Score up to the top of the frame (off-screen until then)
    await page.evaluate("() => { document.body.style.paddingBottom = '900px'; }")
    stops = [("#shelf-title", "Every format", 1500, 2.2), (None, "For shops and chats", 1400, 2.4), ('section[aria-label^="How this kit measures"]', None, 1700, 7.6)]
    for i, (sel, text, ms, dwell) in enumerate(stops):
        y = await page.evaluate(ABS_Y_JS, [sel, text])
        if y is None:
            log(f"WARNING kit: no '{sel or text}' on the page")
            continue
        ex[f"scroll{i}"] = time.time()
        await scroll_to(page, y - (28 if i == len(stops) - 1 else 36), ms)
        ex[f"stop{i}"] = time.time()
        await asyncio.sleep(dwell)
    ex["end"] = time.time()
    await rec.stop()
    m = await marks_of(page)
    m.update(ex)
    return Take("kit", tmp, sorted(rec.frames), m, t0, {"url": url, "kind": "site"})


async def rec_shelf(env: Env) -> Take:
    page = env.pages["site"]
    url = env.url("/shelf/demo-studio")
    await page.goto(url, wait_until="load")
    await settle(page)
    await page.evaluate("() => window.scrollTo(0, document.documentElement.scrollHeight)")
    await settle(page)
    await asyncio.sleep(0.8)
    tmp, _ = await new_take(env, "shelf")
    await page.goto("about:blank")
    rec = Recorder(page, tmp / "frames")
    t0 = time.time()
    await page.goto(url, wait_until="commit")
    await rec.start()
    await page.wait_for_load_state("domcontentloaded")
    y = await page.evaluate(SHOP_FRAME_JS)
    state = await decoded(page)
    ex: dict[str, float] = {"ready": time.time()}
    log(f"shelf: framed at {y}px, images decoded {state}")
    await asyncio.sleep(3.8)
    share = page.locator("a,button", has_text="Share on WhatsApp").first
    if await share.count():
        box = await share.bounding_box()
        cur = Cursor(page)
        await cur.show()
        ex["cursor"] = time.time()
        await cur.move(box["x"] + box["width"] * 0.45, box["y"] + box["height"] * 0.55, wait=2.4)  # hovered, never clicked
        await cur.hide()
    await asyncio.sleep(1.8)
    ex["end"] = time.time()
    await rec.stop()
    m = await marks_of(page)
    m.update(ex)
    return Take("shelf", tmp, sorted(rec.frames), m, t0, {"url": url, "kind": "site"})


async def rec_arch(env: Env) -> Take:
    """The README's architecture diagram, rendered locally from docs/architecture.svg at 2x (no network)."""
    svg = (ROOT / "docs" / "architecture.svg").read_text(encoding="utf-8")
    ctx = await env.browser.new_context(viewport=DECK_VIEWPORT, device_scale_factor=2, color_scheme="dark")
    page = await ctx.new_page()
    html = (
        "<!doctype html><meta charset=utf-8><style>html,body{margin:0;height:100%;background:#0e0c0a}"
        "body{display:grid;place-items:center}svg{width:1680px;height:1050px;display:block}</style>" + svg
    )
    await page.set_content(html, wait_until="load")
    await asyncio.sleep(0.5)
    svg_box = await page.evaluate("() => { const r = document.querySelector('svg').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }")
    tmp, _ = await new_take(env, "arch")
    (tmp / "frames").mkdir()
    await page.screenshot(path=str(tmp / "frames" / "still.png"))
    await ctx.close()
    now = time.time()
    with Image.open(tmp / "frames" / "still.png") as im:
        size = list(im.size)
    return Take("arch", tmp, [(now, "frames/still.png")], {"still": now}, now, {"kind": "still", "source": "docs/architecture.svg", "size": size, "svg_box": svg_box})


def usage_check(base: str) -> dict:
    with urllib.request.urlopen(base.rstrip("/") + "/api/usage", timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


async def rec_live(env: Env, photo: Path, allow_floor: bool) -> Take:
    """ONE real upload on production: pick the photo in the Upload Widget, let the Exact pipeline run to the ZIP link."""
    u = usage_check(env.base)
    tx = u.get("transformations") or {}
    used, floor = tx.get("usedCredits"), tx.get("floorCredits")
    log(f"live: /api/usage says livePipeline={u.get('livePipeline')}, transformation credits {used} used, floor {floor}")
    if not u.get("livePipeline"):
        raise RuntimeError("live kits are paused on this deployment (livePipeline=false): the live run would only show the pause notice. Kept the previous live take.")
    if used is not None and floor is not None and used + 0.4 > floor and not allow_floor:
        raise RuntimeError(f"a live kit (~0.35 credits) would take main from {used} to over its {floor}-credit floor; pass --allow-floor to run it anyway")
    page = env.pages["site"]
    url = env.url("/studio")
    await page.goto(url, wait_until="load")  # warm the studio shell and the sample thumbnails
    await settle(page)
    await asyncio.sleep(1.0)
    tmp, _ = await new_take(env, "live")
    await page.goto("about:blank")
    rec = Recorder(page, tmp / "frames")
    t0 = time.time()
    ex: dict[str, float] = {}
    try:
        await page.goto(url, wait_until="commit")
        await rec.start()
        await page.wait_for_load_state("domcontentloaded")
        await wait_mark(page, "painted", 20)
        await decoded(page)
        ex["ready"] = time.time()
        await asyncio.sleep(1.4)
        btn = page.get_by_role("button", name="Upload a photo").first
        box = await btn.bounding_box()
        cur = Cursor(page)
        await cur.show()
        ex["cursor"] = time.time()
        bx, by = box["x"] + box["width"] * 0.35, box["y"] + box["height"] * 0.55
        await cur.move(bx, by, wait=0.9)  # the hover loads the Upload Widget's script
        await asyncio.sleep(1.2)
        await cur.ring()
        await asyncio.sleep(0.2)
        ex["upload_click"] = time.time()
        await page.mouse.click(bx, by)
        frame = None
        for _ in range(100):
            frame = next((f for f in page.frames if "upload-widget.cloudinary.com" in f.url), None)
            if frame:
                break
            await asyncio.sleep(0.1)
        if frame is None:
            raise RuntimeError("the Upload Widget never opened")
        browse = frame.get_by_text("Browse", exact=True).first
        await browse.wait_for(state="visible", timeout=20000)
        ex["widget"] = time.time()
        await asyncio.sleep(0.9)
        bb = await browse.bounding_box()
        await cur.move(bb["x"] + bb["width"] * 0.45, bb["y"] + bb["height"] * 0.55, wait=0.9)
        await cur.ring()
        ex["browse_click"] = time.time()
        await asyncio.sleep(0.35)
        # the file goes straight to the widget's own input: clicking Browse would open the OS file dialog,
        # which Playwright can leave waiting (a first take sat there for a minute)
        ex["file_set"] = time.time()
        await frame.locator("input[type=file]").first.set_input_files(str(photo))
        log(f"live: {photo.name} chosen, uploading")
        await cur.hide()
        await page.mouse.move(SITE_VIEWPORT["width"] - 30, SITE_VIEWPORT["height"] - 30)
        deadline = time.time() + 240
        seen_alert = None
        while time.time() < deadline:
            m = await marks_of(page)
            if "zip_ready" in m:
                break
            info = await page.evaluate("() => window.__s2sInfo || {}")
            if info.get("alert") and info.get("alert") != seen_alert:
                seen_alert = info.get("alert")
                log(f"live: the studio shows: {seen_alert!r} (waiting; it may recover)")
                if re.search(r"paused|quota", seen_alert, re.I):
                    break
            await asyncio.sleep(0.5)
        m = await marks_of(page)
        info = await page.evaluate("() => window.__s2sInfo || {}")
        if "zip_ready" in m:
            log(f"live: ZIP link after {m['zip_ready'] - ex['file_set']:.1f} s ({info.get('zipLabel')})")
            await asyncio.sleep(2.2)
            zipa = page.locator("section[data-kit] a", has_text="(.zip)").first
            if await zipa.count():
                zb = await zipa.bounding_box()
                if zb and 0 < zb["y"] < SITE_VIEWPORT["height"]:
                    await cur.show()
                    ex["zip_cursor"] = time.time()
                    await cur.move(zb["x"] + zb["width"] * 0.42, zb["y"] + zb["height"] * 0.55, wait=2.0)  # hovered, never clicked
                    await cur.hide()
            await asyncio.sleep(1.0)
        else:
            raise RuntimeError(f"the live run never reached its ZIP link ({info.get('alert') or 'no alert shown'}); kept the previous live take, if any")
        ex["end"] = time.time()
        final_url = page.url
    finally:
        await rec.stop()
    m = await marks_of(page)
    m.update(ex)
    info = await page.evaluate("() => window.__s2sInfo || {}")
    meta = {"url": url, "kind": "site", "photo": photo.name, "final_url": final_url, "info": info, "usage_before": {"used": used, "floor": floor}, "recorded": time.strftime("%Y-%m-%d %H:%M:%S")}
    return Take("live", tmp, sorted(rec.frames), m, t0, meta)


# ─── The edit ────────────────────────────────────────────────────────────────


@dataclass
class Clip:
    take: Take
    start: float  # source wall time (or 0 for a still)
    end: float
    speed: float = 1.0
    still_s: float = 0.0  # a still image held this long, with a slow push-in
    label: str = ""  # "sped" | "real" (live run only)
    camera: list | None = None  # still only: [(seconds, (x, y, w, h) in source px), ...], eased between keyframes
    blend_in: float = 0.0  # dissolve from the last frame of the previous clip (a cut inside a part), seconds

    @property
    def duration(self) -> float:
        return self.still_s if self.still_s else (self.end - self.start) / self.speed


@dataclass
class Caption:
    t0: float  # part-local seconds
    t1: float | None
    title: str
    detail: str = ""


@dataclass
class Part:
    name: str
    take: Take
    chapter: str = ""  # the picture version's lower-third
    chapter_detail: str = ""
    chapter_persist: bool = False  # keep a compact chapter label up for the whole part (honesty labels)
    eyebrow: str = ""  # the captioned version's small label above each caption
    clips: list[Clip] = field(default_factory=list)
    captions: list[Caption] = field(default_factory=list)
    vo: list[tuple[float, str]] = field(default_factory=list)  # (part-local seconds, line)
    shows: str = ""  # one line for the cue sheet: what is on screen
    start: float = 0.0  # timeline seconds (set by assemble)

    def add(self, start: float, end: float, speed: float = 1.0, label: str = "", blend_in: float = 0.0) -> None:
        if end - start > 0.02:
            self.clips.append(Clip(self.take, start, end, speed, label=label, blend_in=blend_in))

    @property
    def duration(self) -> float:
        return sum(c.duration for c in self.clips)

    def at(self, ts: float) -> float:
        """Part-local output seconds at which source wall time `ts` is on screen."""
        acc = 0.0
        for c in self.clips:
            if ts < c.start:
                return acc
            if ts <= c.end:
                return acc + (ts - c.start) / c.speed
            acc += c.duration
        return acc


def first_frame_time(t: Take) -> float:
    return t.frames[0][0] if t.frames else t.t0


def next_frame(t: Take, ts: float, window: float = 0.6) -> float:
    """The paint time of the first frame after ts that visibly differs from the one on screen at ts:
    a mark is set by the page's script a few frames before the new state reaches the screen."""
    from PIL import ImageChops, ImageStat

    times = [f[0] for f in t.frames]
    i = bisect.bisect_right(times, ts)
    if i == 0 or i >= len(times):
        return ts
    small = lambda k: Image.open(t.path(t.frames[k][1])).convert("L").resize((320, 180))
    before = small(i - 1)
    for k in range(i, len(times)):
        if times[k] - ts > window:
            break
        if ImageStat.Stat(ImageChops.difference(before, small(k))).mean[0] > 4.0:
            return times[k] + 0.001
    return times[i] + 0.001


def mark(t: Take, key: str, fallback: float | None = None) -> float:
    if key in t.marks:
        return t.marks[key]
    if fallback is None:
        raise RuntimeError(f"the {t.name} take has no '{key}' mark (the page changed?): re-record it, or adjust build_edit()")
    log(f"WARNING {t.name}: mark '{key}' missing, using a fixed offset")
    return fallback


def build_edit(takes: dict[str, Take], claims: Claims, skip_live: bool) -> list[Part]:
    lo, hi = claims.range_s
    hold = lambda n: HOLD[n] if skip_live else TIGHT_HOLD.get(n, HOLD[n])
    sample_ai = "Sample photo (AI-generated test image)"
    parts: list[Part] = []

    # 1. Title card
    t = takes["title"]
    b = next_frame(t, mark(t, "build", first_frame_time(t) + 1.0))
    p = Part("title", t, shows="Title card: Snap2Shelf · One photo. A whole shelf. · Track 2")
    p.add(b, b + HOLD["title"])
    p.vo = [(0.6, "I'm <YOUR_NAME>. This is Snap2Shelf, for Track 2: Generative Content Workflows.")]
    parts.append(p)

    # 2. The problem: one cluttered phone photo (the deck's cold open)
    t = takes["hook"]
    m0 = mark(t, "mount", first_frame_time(t) + 0.8)
    p = Part("hook", t, chapter="The problem", chapter_detail=sample_ai, eyebrow="The problem", shows="Director's cut, 'One photo': the cluttered-counter sample photo, labelled as an AI-generated test image")
    p.add(m0, m0 + hold("hook"))
    p.captions = [
        Caption(0.5, hold("hook") * 0.45, "Small sellers start with one phone photo", "Often on a cluttered kitchen counter. This one is a sample: an AI-generated test image"),
        Caption(hold("hook") * 0.45, None, "Every channel wants a different image", "And generic AI tools quietly redraw the product"),
    ]
    p.vo = [(0.4, "Small sellers shoot their products on a kitchen counter, with a phone. Every channel wants a different image, and generic AI tools quietly redraw the product.")]
    parts.append(p)

    # 3. The studio's sample replay: rail, QA catch -> fix -> approved, the deal
    t = takes["studio"]
    rail = mark(t, "rail", first_frame_time(t) + 1.0)
    s_in = max(mark(t, "painted", rail - 0.3), mark(t, "photo_sharp", rail + 0.6) - 0.7)
    s_caught = mark(t, "qa_caught", rail + 6.6)
    s_fixed = mark(t, "qa_fixed", rail + 10.8)
    s_deal = mark(t, "deal_start", rail + 13.5)
    s_dealt = mark(t, "dealt", rail + 15.5)
    end = min(s_dealt + STUDIO_TAIL, t.frames[-1][0] - 0.2)
    p = Part("studio", t, chapter="Studio · sample replay", chapter_detail="A saved live run, replayed step by step · " + sample_ai, eyebrow="Studio · sample replay", shows="/studio?sample=shmessy1: Fix → Cut out → Stage → Light-match → QA (caught, auto-fixed, approved) → Pack, then the kit deals onto the shelf")
    p.add(s_in, end)
    c_caught, c_fixed, c_deal = p.at(s_caught), p.at(s_fixed), p.at(s_deal)
    p.captions = [
        Caption(0.3, c_caught - 0.3, "Cut out once, staged on a library scene", "Fix → Cut out → Stage → Light-match. The product's pixels are never redrawn"),
        Caption(c_caught - 0.3, c_deal - 0.2, "QA gate: AI Vision flags a floating bottle", "product-floating → the studio sets it down, checks again → approved"),
        Caption(c_deal - 0.2, None, "One approved hero, every channel format", "Story, banner, marketplace white, WhatsApp tile, colour variants, a Hindi + English offer, a reel"),
    ]
    p.vo = [
        (0.3, "Snap2Shelf reads the photo, cuts the product out once, and stages it on a scene from its library."),
        (c_caught - 0.3, "A QA gate checks every image. Here AI Vision caught a bottle that looked like it was floating, so the studio set it down and checked again. Approved."),
        (c_deal + 0.3, "Then it deals out the whole shelf: a story, a banner, a marketplace-white image, a WhatsApp tile, colour variants, and a Diwali offer in Hindi and English."),
    ]
    parts.append(p)

    # 3b. Kit reel: stands in for the live run's time while there is no live take
    if skip_live and "reel" in takes:
        t = takes["reel"]
        m0 = mark(t, "mount", first_frame_time(t) + 0.8)
        p = Part("reel", t, chapter="Kit reel", eyebrow="Kit reel", shows="Director's cut, 'Kit reel': the 9:16 reel playing in a phone frame, the stored images it is cut from, the URL parts that make it")
        p.add(m0, m0 + HOLD["reel"])
        p.captions = [Caption(0.5, None, "A video reel, made by one URL", "Stored images become Ken Burns clips, spliced, with the offer held on top")]
        p.vo = [(0.4, "Even the video reel is one URL: the stored images become Ken Burns clips, spliced together with the offer held on top.")]
        parts.append(p)

    # 4-6. Director's cut: QA gate, Scene DNA, Every stage
    for name, chapter, shows, caps, vo in (
        (
            "qa",
            "QA gate · Creative mode",
            "Director's cut, 'QA gate': flux-2-flash-edit's take REJECTED (logo badge, ghost second shoe), nano-banana-2-edit's APPROVED",
            [
                Caption(0.5, 6.2, "Creative mode: the gate compares every take with the photo", "An image model restages the product, so AI Vision checks it hasn't changed"),
                Caption(6.2, None, "flux-2-flash-edit: product-redesigned · extra-product → rejected", "It added a logo badge and a ghost second shoe. nano-banana-2-edit kept the product → approved"),
            ],
            [(0.4, "In Creative mode an image model restages the product, so the gate compares every take with the photo. The fast model added a logo badge and a ghost second shoe: rejected. The faithful one passes.")],
        ),
        (
            "dna",
            "Scene DNA",
            "Director's cut, 'Scene DNA': surface, anchor, light and text zone drawn on the plate; the product lands; the difference-mode pixel proof",
            [
                Caption(0.5, 8.5, "Scene DNA: surface, light, text zone", "AI Vision reads each library scene once"),
                Caption(8.5, None, "The product lands on the anchor, lit by the scene", "Difference mode against the cut-out: the product goes black, only the light changed"),
            ],
            [(0.4, "How does it know where the table is, and where the light comes from? AI Vision reads each scene once: we call that Scene DNA. Lay the cut-out over the render in difference mode and the product goes black: only the light changed.")],
        ),
        (
            "stages",
            "Every stage",
            "Director's cut, 'Every stage': the same cut-out on every library scene",
            [Caption(0.5, None, "One cut-out, every scene", claims.credits_saved)],
            [(0.4, "Then the same cut-out goes onto every scene, and it never moves by a pixel. Reusing a library scene costs zero new generation credits.")],
        ),
    ):
        t = takes[name]
        m0 = mark(t, "mount", first_frame_time(t) + 0.8)
        p = Part(name, t, chapter=chapter, eyebrow=chapter, shows=shows)
        p.add(m0, m0 + hold(name))
        p.captions, p.vo = caps, vo
        parts.append(p)

    # 7. The live run on production
    if not skip_live:
        parts.append(live_part(takes["live"], claims))

    # 8. Kit page + ZIP + Readiness
    t = takes["kit"]
    k0 = mark(t, "ready", first_frame_time(t) + 1.5) - 0.15
    k1 = mark(t, "end", t.frames[-1][0])
    p = Part("kit", t, chapter="Kit page + ZIP", chapter_detail="snap2shelf.vercel.app/kit/shmessy1 · sample kit", eyebrow="Kit page + ZIP", shows="/kit/shmessy1: the hero and its 'Download … (.zip)' button (hovered, not clicked), every format, the Readiness Score")
    p.add(k0, k1)
    r_at = p.at(mark(t, "scroll2", k0 + 10.0))
    p.captions = [
        Caption(0.4, 4.6, "Every kit: one page, one ZIP", "The ZIP holds every image; the reel plays from its Cloudinary URL"),
        Caption(4.6, r_at, "Every format, framed where it will live", "For social · for shops and chats · colour and creative variants"),
        Caption(r_at, None, "Readiness Score, measured on the pixels", "Pure white background and fill, checked the way a marketplace would"),
    ]
    p.vo = [
        (0.4, "Every kit gets its own page and one ZIP with every image."),
        (4.8, "Each format is framed where it will live: social, shops and chats, colour variants."),
        (r_at + 0.2, "And it checks the listing like a marketplace would, on the actual pixels: pure white background, the product filling the frame."),
    ]
    parts.append(p)

    # 9. Shop shelf
    t = takes["shelf"]
    s0 = mark(t, "painted", mark(t, "ready", first_frame_time(t) + 1.0) - 0.4) + 0.03
    s1 = mark(t, "end", t.frames[-1][0])
    p = Part("shelf", t, chapter="Shop shelf", chapter_detail="snap2shelf.vercel.app/shelf/demo-studio · sample products", eyebrow="Shop shelf", shows="/shelf/demo-studio: the shop shelf; 'Share on WhatsApp' hovered, not clicked")
    p.add(s0, s1)
    p.captions = [Caption(0.5, None, "Share the shelf, not a folder of files", "Every product lands on a shop page with its own WhatsApp preview")]
    p.vo = [(0.4, "And every product lands on a shop shelf the seller can share straight to WhatsApp, with its own preview image.")]
    parts.append(p)

    # 10-11. Director's cut: It's a URL, What it cost
    for name, chapter, shows, caps, vo in (
        (
            "xray",
            "It's a URL",
            "Director's cut, 'It's a URL': the hero's delivery URL, colour-coded by what each part does",
            [Caption(0.5, None, "No image files. Just URLs.", "Scene · the product as a layer · shadows · light-match · format, in one delivery URL")],
            [(0.4, "Everything you've seen is a Cloudinary URL. No image files, no GPU server: the scene, the product as a layer, a shadow projected from its own silhouette, then a warm light-match.")],
        ),
        (
            "cost",
            "What it cost",
            "Director's cut, 'What it cost': the kit's receipt, 0 new generation credits, the photoshoot estimate",
            [Caption(0.5, None, claims.credits_saved.split(" — ")[0], f"The scene is reused from the library · a basic studio shoot: about ₹{claims.photoshoot_inr:,} (our estimate)")],
            [(0.4, "And it's cheap. Zero new generation credits: the scene is reused from the library. A basic studio shoot for one product would be around two and a half thousand rupees, by our estimate.")],
        ),
    ):
        t = takes[name]
        m0 = mark(t, "mount", first_frame_time(t) + 0.8)
        p = Part(name, t, chapter=chapter, eyebrow=chapter, shows=shows)
        p.add(m0, m0 + hold(name))
        p.captions, p.vo = caps, vo
        parts.append(p)

    # 12. Architecture (still, slow push-in)
    t = takes["arch"]
    p = Part("arch", t, chapter="Architecture", chapter_detail="From the README · docs/architecture.svg", eyebrow="Architecture", shows="The README's architecture diagram (docs/architecture.svg)")
    p.clips.append(Clip(t, 0.0, 0.0, still_s=hold("arch"), camera=arch_camera(t, hold("arch"))))
    p.captions = [
        Caption(0.6, 10.8 * hold("arch") / HOLD["arch"], "Cloudinary is the whole backend", "Uploads · AI Vision · image generation · transformations · video · tags as the database · delivery"),
        Caption(10.8 * hold("arch") / HOLD["arch"], None, "AI calls balanced across organiser-approved environments", "Disclosed in the README · built with Claude Code and Cloudinary's Skills Pack"),
    ]
    p.vo = [(0.5, "Cloudinary is the whole backend: uploads, AI Vision, image generation, transformations, video, tags as the database, and delivery. AI calls are balanced across three Cloudinary environments, which the organisers approved, and the README discloses it. I built it with Claude Code, using Cloudinary's Skills Pack.")]
    parts.append(p)

    # 13. Outro card
    t = takes["outro"]
    b = next_frame(t, mark(t, "build", first_frame_time(t) + 1.0))
    p = Part("outro", t, shows="Outro card: 'Try it — no signup.' snap2shelf.vercel.app, the repo, a QR code")
    p.add(b, b + HOLD["outro"])
    p.vo = [(0.8, "Try it yourself, no signup: snap2shelf.vercel.app.")]
    parts.append(p)
    return parts


def arch_camera(t: Take, total: float) -> list:
    """Full diagram, then the Cloudinary block, then the key pool (SVG coordinates mapped to the 2x still)."""
    sw, sh = t.meta.get("size", [W * 2, H * 2])
    svg = t.meta.get("svg_box", [120, 15, 1680, 1050])  # where the 1600x1000 viewBox sits on the 1920x1080 page, CSS px
    k = sw / W  # device pixels per CSS px
    sx = svg[2] / 1600

    def box(cx: float, cy: float, w_svg: float) -> tuple[float, float, float, float]:
        w_ = w_svg * sx * k
        h_ = w_ * 9 / 16
        x = (svg[0] + cx * sx) * k - w_ / 2
        y = (svg[1] + cy * sx) * k - h_ / 2
        return (max(0.0, min(sw - w_, x)), max(0.0, min(sh - h_, y)), w_, h_)

    full = (0.0, 0.0, float(sw), float(sh))
    near = (sw * 0.02, sh * 0.02, sw * 0.96, sh * 0.96)
    cloud = box(1130, 530, 1180)  # Cloudinary main environment: Analyze, Upload, Generation, Background removal, Transformations
    pool = box(640, 690, 980)  # Guards, the key pool, the organiser-approved pool environments
    k2 = total / HOLD["arch"]
    return [(0.0, full), (4.6 * k2, near), (6.8 * k2, cloud), (10.6 * k2, cloud), (12.8 * k2, pool), (total, pool)]


SPEEDS = (2, 3, 4, 5, 6, 8, 10, 12)


def live_part(t: Take, claims: Claims) -> Part:
    """Real time where something happens on screen (the upload, the deal, the ZIP link); the waits between, sped up with a label."""
    lo, hi = claims.range_s
    m = t.marks
    begin = mark(t, "ready", first_frame_time(t) + 1.0) - 0.2
    file_set = mark(t, "file_set")
    last = t.frames[-1][0] - 0.1
    finish = min(mark(t, "end", last), last)
    # the pointer reaches Browse and clicks; anything between that click and the file landing in the widget
    # is waiting on the file dialog, before the photo -> ZIP clock starts: it is cut (with a dissolve), not sped up
    clicked = m.get("browse_click", m.get("widget", file_set - 2.0) + 2.0)
    cut = (clicked + 0.45, file_set - 0.15) if file_set - clicked > 1.5 else None
    windows = [(begin, file_set + 1.5)] if cut is None else [(begin, cut[0]), (cut[1], file_set + 1.5)]
    if "deal_start" in m:
        windows.append((m["deal_start"] - 0.8, m.get("dealt", m["deal_start"] + 2.5) + 1.2))
    if "zip_ready" in m:
        windows.append((m["zip_ready"] - 1.5, finish))
    else:
        windows.append((max(begin, finish - 4.0), finish))
    windows.sort()
    merged: list[list[float]] = []
    for a, b in windows:
        a, b = max(a, begin), min(b, finish)
        if merged and a <= merged[-1][1] + 1.5 and not (cut and merged[-1][1] == cut[0]):  # gaps under 1.5 s aren't worth a speed change
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    real = sum(b - a for a, b in merged)
    gaps = [(merged[i][1], merged[i + 1][0]) for i in range(len(merged) - 1) if not (cut and merged[i][1] == cut[0])]
    gap_total = sum(b - a for a, b in gaps)
    budget = max(4.0, LIVE_TARGET_S - real)
    need = gap_total / budget if gap_total else 1
    speed = min(SPEEDS, key=lambda s_: abs(s_ - need))  # the nearest round factor (the badge shows it)
    p = Part(
        "live",
        t,
        chapter="Live run · snap2shelf.vercel.app",
        chapter_detail=f"One real upload, every step live on Cloudinary · {claims.sample_label.lower()} (AI-generated test image)",
        chapter_persist=True,
        eyebrow="Live run · sample photo (AI-generated test image)",
        shows=f"/studio on production: 'Upload a photo' → Upload Widget → Browse → {t.meta.get('photo', 'the photo')}; the pipeline runs live (sped up ×{speed} between the moments that matter, labelled); the kit deals in; the ZIP link appears (hovered, not clicked)",
    )
    for a, b in merged:
        p.add(a, b, 1.0, label="real", blend_in=0.35 if cut and a == cut[1] else 0.0)
        gap = next((g for g in gaps if abs(g[0] - b) < 1e-6), None)
        if gap:
            p.add(gap[0], gap[1], float(speed), label="sped")
    fs = p.at(file_set)
    sped = [c for c in p.clips if c.label == "sped"]
    first_sped = p.at(sped[0].start) if sped else fs + 2
    deal = p.at(m["deal_start"]) if "deal_start" in m else p.duration - 6
    zip_at = p.at(m["zip_ready"]) if "zip_ready" in m else None
    mid = first_sped + max(2.5, (deal - first_sped) * 0.45)
    p.captions = [
        Caption(0.4, first_sped, "A live run on the production site", "Upload a photo → the Cloudinary Upload Widget → pick the file"),
        Caption(first_sped, mid, "Every step runs live on Cloudinary", "AI Vision · background removal · the composite · QA · the pack"),
        Caption(mid, deal - 0.3, f"Photo → ZIP in {claims.photo_to_kit}", f"{lo}–{hi} s in our timed live runs (most of the spread is upload time)"),
        Caption(deal - 0.3, (zip_at - 0.4) if zip_at and zip_at - deal > 2.5 else None, "The kit deals in" if zip_at and zip_at - deal > 2.5 else "The kit deals in, the ZIP is ready", "Every format from one approved hero" if zip_at and zip_at - deal > 2.5 else "Every format from one approved hero, in one download"),
    ]
    if zip_at and zip_at - deal > 2.5:
        p.captions.append(Caption(zip_at - 0.4, None, "ZIP ready", "Every image in one download"))
    p.vo = [
        (0.4, "Now a live run on the production site: a sample photo, an AI-generated test image, and every step runs for real on Cloudinary."),
        (first_sped + 0.3, f"This part is sped up. Photo to zip takes {claims.photo_to_kit}: {words(lo)} to {words(hi)} seconds in our timed live runs."),
        (deal, "The kit deals in, and the ZIP is ready to download."),
    ]
    p.speed = speed  # type: ignore[attr-defined]
    p.cut_s = (cut[1] - cut[0]) if cut else 0.0  # type: ignore[attr-defined]
    run_s = (m["zip_ready"] - file_set) if "zip_ready" in m else None
    p.run_s = run_s  # type: ignore[attr-defined]
    return p


def words(n: int) -> str:
    """36 -> 'thirty-six', for the read-aloud line."""
    ones = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
    tens = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
    if n < 20:
        return ones[n]
    if n < 100:
        return tens[n // 10] + ("" if n % 10 == 0 else "-" + ones[n % 10])
    return str(n)


def assemble(parts: list[Part]) -> float:
    t = 0.0
    for i, p in enumerate(parts):
        p.start = t if i == 0 else t - XFADE
        t = p.start + p.duration
    return t


# ─── Drawing ─────────────────────────────────────────────────────────────────


class Fonts:
    """The site's own faces (Bricolage Grotesque for display, Hanken Grotesk for text), with Segoe UI / DejaVu for glyphs they lack."""

    def __init__(self, work: Path):
        self.dir = work / "fonts"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.cache: dict[tuple, list] = {}
        self.fallback_paths = [p for p in ("C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/seguisym.ttf", "/System/Library/Fonts/Supplemental/Arial Unicode.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf") if os.path.exists(p)]
        self.fallback_bold = [p for p in ("C:/Windows/Fonts/seguisb.ttf", "C:/Windows/Fonts/segoeuib.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf") if os.path.exists(p)]
        self.brand = {"display": self._convert("bricolage-latin.woff2"), "text": self._convert("hanken-latin.woff2")}

    def _convert(self, woff2: str) -> Path | None:
        src = ROOT / "app" / "fonts" / woff2
        out = self.dir / (Path(woff2).stem + ".ttf")
        if out.exists():
            return out
        try:
            from fontTools.ttLib import TTFont

            f = TTFont(str(src))
            f.flavor = None
            f.save(str(out))
            return out
        except Exception as e:  # fonttools/brotli missing: system fonts only
            log(f"(brand font {woff2} unavailable: {type(e).__name__}; using system fonts)")
            return None

    def chain(self, face: str, size: int, weight: int) -> list:
        key = (face, size, weight)
        if key in self.cache:
            return self.cache[key]
        fonts = []
        path = self.brand.get(face)
        if path:
            f = ImageFont.truetype(str(path), size)
            try:
                axes = f.get_variation_axes()
                vals = []
                for a in axes:
                    nm = a.get("name", b"")
                    nm = nm.decode() if isinstance(nm, bytes) else str(nm)
                    if nm.lower().startswith("weight"):
                        vals.append(weight)
                    elif nm.lower().startswith("optical"):
                        vals.append(max(a["minimum"], min(a["maximum"], size)))
                    else:
                        vals.append(a.get("default", a["maximum"]))
                f.set_variation_by_axes(vals)
            except Exception:
                pass
            fonts.append((f, cmap_of(path)))
        for fp in (self.fallback_bold if weight >= 600 else []) + self.fallback_paths:
            fonts.append((ImageFont.truetype(fp, size), cmap_of(Path(fp))))
        if not fonts:
            fonts.append((ImageFont.load_default(size=size), None))
        self.cache[key] = fonts
        return fonts


_CMAPS: dict[Path, set[int]] = {}


def cmap_of(path: Path) -> set[int] | None:
    """The code points a font file covers (None: unknown, treated as covering everything)."""
    if path not in _CMAPS:
        try:
            from fontTools.ttLib import TTFont

            _CMAPS[path] = set(TTFont(str(path), lazy=True).getBestCmap().keys())
        except Exception:
            _CMAPS[path] = None  # type: ignore[assignment]
    return _CMAPS[path]


def runs(text: str, chain: list) -> list[tuple[str, object]]:
    """Split text into runs, each drawn with the first font in the chain that has its glyphs."""
    out: list[tuple[str, object]] = []
    for ch in text:
        font = chain[0][0]
        for f, cmap in chain:
            if cmap is None or ord(ch) in cmap or ch == " ":
                font = f
                break
        if out and out[-1][1] is font:
            out[-1] = (out[-1][0] + ch, font)
        else:
            out.append((ch, font))
    return out


def text_width(text: str, chain: list) -> float:
    return sum(f.getlength(s) for s, f in runs(text, chain))


def draw_text(d: ImageDraw.ImageDraw, xy: tuple[float, float], text: str, chain: list, fill) -> None:
    """Draws on the baseline at xy."""
    x, y = xy
    for s, f in runs(text, chain):
        d.text((x, y), s, font=f, fill=fill, anchor="ls")
        x += f.getlength(s)


def wrap(text: str, chain: list, max_w: float) -> list[str]:
    words, lines, cur = text.split(" "), [], ""
    for w_ in words:
        test = (cur + " " + w_).strip()
        if cur and text_width(test, chain) > max_w:
            lines.append(cur)
            cur = w_
        else:
            cur = test
    if cur:
        lines.append(cur)
    return lines


class Painter:
    def __init__(self, fonts: Fonts):
        self.fonts = fonts
        self.cache: dict[tuple, Image.Image] = {}

    def caption(self, title: str, detail: str, eyebrow: str) -> Image.Image:
        """The captioned version's bottom-centre card: an eyebrow (the chapter), a title and one detail line."""
        key = ("cap", title, detail, eyebrow)
        if key in self.cache:
            return self.cache[key]
        f_eb = self.fonts.chain("text", 18, 700)
        f_t = self.fonts.chain("display", 36, 700)
        f_d = self.fonts.chain("text", 24, 450)
        max_w = 1240
        t_lines = wrap(title, f_t, max_w)
        d_lines = wrap(detail, f_d, max_w) if detail else []
        eb = eyebrow.upper()
        w = int(max([text_width(eb, f_eb) + 2 * len(eb)] + [text_width(s, f_t) for s in t_lines] + [text_width(s, f_d) for s in d_lines])) + 64
        h = 20 + (26 if eb else 0) + 43 * len(t_lines) + (6 + 31 * len(d_lines) if d_lines else 0) + 16
        im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        d.rounded_rectangle((0, 0, w - 1, h - 1), radius=20, fill=INK + (226,), outline=(255, 255, 255, 26), width=1)
        y = 20
        if eb:
            x = 32
            for ch in eb:  # letter-spaced eyebrow
                draw_text(d, (x, y + 16), ch, f_eb, MARIGOLD_HI + (255,))
                x += text_width(ch, f_eb) + 2
            y += 26
        for s in t_lines:
            draw_text(d, (32, y + 34), s, f_t, PAPER + (255,))
            y += 43
        if d_lines:
            y += 6
            for s in d_lines:
                draw_text(d, (32, y + 23), s, f_d, DIM + (255,))
                y += 31
        self.cache[key] = im
        return im

    def chapter(self, title: str, detail: str, compact: bool = False) -> Image.Image:
        """The picture version's lower-third: a marigold bar, the chapter, one detail line."""
        key = ("ch", title, detail, compact)
        if key in self.cache:
            return self.cache[key]
        f_t = self.fonts.chain("display", 24 if compact else 34, 700)
        f_d = self.fonts.chain("text", 19 if compact else 23, 450)
        tw = text_width(title, f_t)
        dw = text_width(detail, f_d) if detail else 0
        if compact:
            text = title + ("  ·  " if detail else "")
            w = int(text_width(text, f_t) + dw) + 64
            h = 50
        else:
            w = int(max(tw, dw)) + 72
            h = 26 + 42 + (34 if detail else 0) + 16
        im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        d.rounded_rectangle((0, 0, w - 1, h - 1), radius=16 if compact else 18, fill=INK + (222,), outline=(255, 255, 255, 26), width=1)
        if compact:
            d.rounded_rectangle((22, 15, 26, h - 15), radius=2, fill=MARIGOLD + (255,))
            draw_text(d, (38, 33), title + ("  ·  " if detail else ""), f_t, PAPER + (255,))
            if detail:
                draw_text(d, (38 + text_width(title + "  ·  ", f_t), 32), detail, f_d, DIM + (255,))
        else:
            d.rounded_rectangle((24, 28, 29, 28 + 34), radius=2, fill=MARIGOLD + (255,))
            draw_text(d, (42, 26 + 34), title, f_t, PAPER + (255,))
            if detail:
                draw_text(d, (42, 26 + 42 + 26), detail, f_d, DIM + (255,))
        self.cache[key] = im
        return im

    def badge(self, text: str, strong: bool) -> Image.Image:
        key = ("badge", text, strong)
        if key in self.cache:
            return self.cache[key]
        f = self.fonts.chain("text", 24, 800 if strong else 600)
        tw = text_width(text, f)
        w, h = int(tw) + 40, 46
        im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        if strong:
            d.rounded_rectangle((0, 0, w - 1, h - 1), radius=23, fill=MARIGOLD + (245,))
            draw_text(d, (20, 31), text, f, INK + (255,))
        else:
            d.rounded_rectangle((0, 0, w - 1, h - 1), radius=23, fill=INK + (215,), outline=(255, 255, 255, 40), width=1)
            draw_text(d, (20, 31), text, f, PAPER + (235,))
        self.cache[key] = im
        return im


def paste_fade(frame: Image.Image, im: Image.Image, xy: tuple[int, int], a: float) -> None:
    if a <= 0:
        return
    if a >= 0.999:
        frame.paste(im, xy, im)
        return
    alpha = im.getchannel("A").point(lambda v: int(v * a))
    frame.paste(im, xy, alpha)


def fade_in_out(t: float, t0: float, t1: float, f: float = 0.22) -> float:
    if t < t0 or t >= t1:
        return 0.0
    return max(0.0, min(1.0, (t - t0) / f, (t1 - t) / f))


def ease(u: float) -> float:
    u = max(0.0, min(1.0, u))
    return u * u * (3 - 2 * u)


# ─── Render ──────────────────────────────────────────────────────────────────


class FramePicker:
    def __init__(self, take: Take):
        self.take = take
        self.times = [f[0] for f in take.frames]
        self.paths = [take.path(f[1]) for f in take.frames]
        self._cache: tuple[Path, Image.Image] | None = None

    def at(self, ts: float) -> tuple[Image.Image, Path]:
        """The frame on screen at wall time ts: the last one painted at or before it."""
        i = max(0, bisect.bisect_right(self.times, ts) - 1)
        path = self.paths[i]
        if self._cache and self._cache[0] == path:
            return self._cache[1], path
        im = Image.open(path).convert("RGB")
        if im.size != (W, H) and not self.take.meta.get("kind") == "still":
            im = im.resize((W, H), Image.LANCZOS)
        self._cache = (path, im)
        return im, path


@dataclass
class Placed:
    part: Part
    clip: Clip
    t0: float  # timeline start
    t1: float
    first: bool  # first clip of its part (dissolves in)


def place(parts: list[Part]) -> list[Placed]:
    out = []
    for p in parts:
        t = p.start
        for i, c in enumerate(p.clips):
            out.append(Placed(p, c, t, t + c.duration, i == 0))
            t += c.duration
    return out


def source(pl: Placed, t: float, pickers: dict[str, FramePicker]) -> tuple[Image.Image, Path | None]:
    c = pl.clip
    local = max(0.0, min(t - pl.t0, c.duration - 1e-3))
    if c.still_s:
        im, path = pickers[c.take.name].at(0)
        if c.camera:
            box = camera_box(c.camera, local)
        else:
            u = local / c.still_s
            s = 1.0 - 0.05 * u  # a slow push-in
            cw, ch = im.width * s, im.height * s
            box = ((im.width - cw) / 2, (im.height - ch) / 2, (im.width + cw) / 2, (im.height + ch) / 2)
        return im.resize((W, H), Image.LANCZOS, box=box, reducing_gap=2.0), None
    return pickers[c.take.name].at(c.start + local * c.speed)


def camera_box(keys: list, t: float) -> tuple[float, float, float, float]:
    """(x0, y0, x1, y1) at time t: holds on each keyframe, eases between them."""
    if t <= keys[0][0]:
        x, y, w, h = keys[0][1]
        return (x, y, x + w, y + h)
    for (ta, a), (tb, b) in zip(keys, keys[1:]):
        if t <= tb:
            u = ease((t - ta) / max(1e-6, tb - ta))
            x, y, w, h = (a[i] + (b[i] - a[i]) * u for i in range(4))
            return (x, y, x + w, y + h)
    x, y, w, h = keys[-1][1]
    return (x, y, x + w, y + h)


def nvenc_available() -> bool:
    """True when ffmpeg can open NVIDIA's H.264 encoder on this machine (a GPU with NVENC and a working driver)."""
    try:
        r = subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=0.2:size=1920x1080:rate=30",
             "-c:v", "h264_nvenc", "-f", "null", "-"],
            capture_output=True, timeout=30,
        )
        return r.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def video_encoder(encode_preset: str, crf: int) -> list[str]:
    """H.264 High, yuv420p: NVENC when the GPU can do it (S2S_ENCODER=x264 forces the CPU), else libx264."""
    if os.environ.get("S2S_ENCODER", "auto") != "x264" and nvenc_available():
        log(f"encoder: h264_nvenc (p7, hq, constant quality {crf})")
        return ["-c:v", "h264_nvenc", "-preset", "p7", "-tune", "hq", "-rc", "vbr", "-cq", str(crf), "-b:v", "0",
                "-profile:v", "high", "-pix_fmt", "yuv420p"]
    log(f"encoder: libx264 ({encode_preset}, crf {crf})")
    return ["-c:v", "libx264", "-preset", encode_preset, "-crf", str(crf), "-profile:v", "high", "-pix_fmt", "yuv420p"]


def render(parts: list[Part], total: float, out_dir: Path, work: Path, encode_preset: str, crf: int) -> dict:
    painter = Painter(Fonts(work))
    placed = place(parts)
    pickers = {p.take.name: FramePicker(p.take) for p in parts}
    starts = [pl.t0 for pl in placed]
    n = int(math.floor(total * FPS))
    review = work / "review"
    shutil.rmtree(review, ignore_errors=True)
    (review / "thumbs").mkdir(parents=True)
    mids = {p.name: p.start + (p.duration / 2 if p.name != "live" else p.duration * 0.62) for p in parts}
    heads = {p.name: p.start + XFADE + 1.2 for p in parts}
    x264 = [*video_encoder(encode_preset, crf),
        "-g", str(FPS * 2), "-bf", "2", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
        "-movflags", "+faststart", "-an",
    ]
    vf = "scale=out_color_matrix=bt709:out_range=tv:flags=lanczos,format=yuv420p"
    outs = {"picture": work / PICTURE_NAME, "captioned": work / CAPTIONED_NAME}
    procs = {
        k: subprocess.Popen(["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-vf", vf, *x264, str(v)], stdin=subprocess.PIPE)
        for k, v in outs.items()
    }
    # the live run's speed badge
    speed = next((getattr(p, "speed", None) for p in parts if p.name == "live"), None)
    uniq: dict[str, set] = {p.name: set() for p in parts}
    tick = time.time()
    for k in range(n):
        t = k / FPS
        i = max(0, bisect.bisect_right(starts, t) - 1)
        cur = placed[i]
        im, path = source(cur, t, pickers)
        if path:
            uniq[cur.part.name].add(path)
        # dissolve from the previous part into this one
        if cur.first and i > 0 and t - cur.t0 < XFADE:
            prev = placed[i - 1]
            under, _ = source(prev, t, pickers)
            im = Image.blend(under, im, ease((t - cur.t0) / XFADE))
        elif not cur.first and cur.clip.blend_in and t - cur.t0 < cur.clip.blend_in:
            prev = placed[i - 1]
            under, _ = source(prev, prev.t1 - 1e-3, pickers)
            im = Image.blend(under, im, ease((t - cur.t0) / cur.clip.blend_in))
        frame = im.copy() if im.mode == "RGB" else im.convert("RGB")
        part = cur.part
        local = t - part.start
        in_part = (part.start + (XFADE if part is not parts[0] else 0), part.start + part.duration - (XFADE if part is not parts[-1] else 0))

        # both versions: the live run's speed badge (top right, under the site's nav)
        if part.name == "live" and speed:
            lbl = cur.clip.label
            a = fade_in_out(t, in_part[0] + 0.3, in_part[1], 0.15)
            if lbl == "sped":
                b = painter.badge(f"▶▶  Sped up ×{speed}", True)
            else:
                b = painter.badge("Real time", False)
            paste_fade(frame, b, (W - b.width - 44, 96), a)

        pic = frame.copy()
        # picture version: the chapter lower-third (bottom left)
        if part.chapter:
            a_full = fade_in_out(t, in_part[0] + 0.25, min(in_part[1], in_part[0] + 0.25 + 4.6))
            if a_full > 0:
                chip = painter.chapter(part.chapter, part.chapter_detail)
                paste_fade(pic, chip, (48, H - chip.height - 44 + int((1 - a_full) * 10)), a_full)
            elif part.chapter_persist:
                a_c = fade_in_out(t, in_part[0] + 0.25 + 4.6, in_part[1])
                chip = painter.chapter("LIVE", "sample photo (AI-generated test image)", compact=True)
                paste_fade(pic, chip, (48, H - chip.height - 44), a_c)
        # captioned version: story captions (bottom centre), the chapter as their eyebrow
        cap = frame
        for c in part.captions:
            c1 = c.t1 if c.t1 is not None else (in_part[1] - part.start)
            a = fade_in_out(local, c.t0, c1)
            if a > 0:
                card = painter.caption(c.title, c.detail, part.eyebrow)
                paste_fade(cap, card, ((W - card.width) // 2, H - card.height - 30 + int((1 - a) * 10)), a)
        procs["picture"].stdin.write(pic.tobytes())
        procs["captioned"].stdin.write(cap.tobytes())
        if k % FPS == 0:
            cap.resize((480, 270), Image.BILINEAR).save(review / "thumbs" / f"t{k // FPS:04d}.jpg", quality=80)
        for name, when in list(mids.items()) + [(n_ + "_head", w_) for n_, w_ in heads.items()]:
            if abs(t - when) < 0.5 / FPS:
                cap.save(review / f"{name}_{t:06.2f}s.jpg", quality=90)
                pic.save(review / f"{name}_{t:06.2f}s_picture.jpg", quality=90)
        if k and k % (FPS * 20) == 0:
            log(f"render: {t:5.0f} s of {total:.0f} s ({k / max(1e-6, time.time() - tick):.0f} fps)")
    for pr in procs.values():
        pr.stdin.close()
    for k_, pr in procs.items():
        if pr.wait() != 0:
            raise RuntimeError(f"ffmpeg failed writing the {k_} edit")
    out_dir.mkdir(parents=True, exist_ok=True)
    result = {}
    for k_, v in outs.items():
        dst = out_dir / v.name
        shutil.move(str(v), str(dst))
        result[k_] = dst
    for p in parts:
        frames_used = uniq[p.name]
        if p.clips and not p.clips[0].still_s:
            log(f"  {p.name:7s} {len(frames_used):4d} distinct source frames for {p.duration * FPS:5.0f} output frames")
    contact_sheets(parts, review)
    return result


def contact_sheets(parts: list[Part], review: Path) -> None:
    thumbs = sorted((review / "thumbs").glob("t*.jpg"))
    for p in parts:
        a, b = int(math.ceil(p.start)), int(math.floor(p.start + p.duration))
        sel = [th for th in thumbs if a <= int(th.stem[1:]) <= b]
        if not sel:
            continue
        cols = 6
        rows = math.ceil(len(sel) / cols)
        sheet = Image.new("RGB", (cols * 480, rows * 270), (30, 30, 30))
        for j, th in enumerate(sel):
            sheet.paste(Image.open(th), ((j % cols) * 480, (j // cols) * 270))
        sheet.save(review / f"sheet_{ORDER.index(p.name) + 1:02d}_{p.name}.jpg", quality=82)


# ─── Cue sheet and subtitles ─────────────────────────────────────────────────


def tc(s: float) -> str:
    s = max(0.0, s)
    return f"{int(s // 60)}:{s % 60:04.1f}"


def srt_tc(s: float) -> str:
    ms = int(round(max(0.0, s) * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def write_srt(parts: list[Part], path: Path) -> None:
    rows = []
    for p in parts:
        end_local = p.duration - (XFADE if p is not parts[-1] else 0)
        for c in p.captions:
            t0 = p.start + c.t0
            t1 = p.start + (c.t1 if c.t1 is not None else end_local)
            text = c.title + ("\n" + c.detail if c.detail else "")
            rows.append((t0, t1, text))
    path.write_text("\n".join(f"{i}\n{srt_tc(a)} --> {srt_tc(b)}\n{t}\n" for i, (a, b, t) in enumerate(rows, 1)), encoding="utf-8")


def write_cue_sheet(parts: list[Part], total: float, path: Path, files: dict, meta: dict) -> None:
    lines = [
        "# Snap2Shelf walkthrough: voice-over cue sheet",
        "",
        f"Matched to `{PICTURE_NAME}` ({tc(total)}, 1920×1080, 30 fps, no audio), rendered {time.strftime('%Y-%m-%d %H:%M')} from {meta['base']}.",
        "Read each line starting at its timecode; the \"window\" is how long the picture holds before the next line, and \"pace\" is the words per second it needs (about 2.5 is a relaxed read; above 2.8, trim a few words).",
        "Replace `<YOUR_NAME>` in the first line. Every number here comes from `lib/claims.ts` (say \"about a minute\" for speed, never a single run's seconds).",
        "",
        "| Timecode | Segment | On screen | Voice-over | Window | Pace |",
        "|---|---|---|---|---|---|",
    ]
    cues = []
    for p in parts:
        for at, text in p.vo:
            cues.append((p.start + at, p, text))
    cues.sort(key=lambda c: c[0])
    for i, (t0, p, text) in enumerate(cues):
        t1 = cues[i + 1][0] if i + 1 < len(cues) else total
        words = len(re.findall(r"[\w'’<>-]+", text))
        win = max(0.1, t1 - t0)
        rate = words / win
        flag = " ⚠" if rate > 2.8 else ""
        shows = p.shows if (i == 0 or cues[i - 1][1] is not p) else "″"
        lines.append(f"| {tc(t0)} | {p.name} | {shows} | {text} | {win:.1f} s | {rate:.1f} w/s{flag} |")
    lines += [
        "",
        "## Segments",
        "",
        "| Starts | Ends | Segment | Chapter caption |",
        "|---|---|---|---|",
    ]
    for p in parts:
        lines.append(f"| {tc(p.start)} | {tc(p.start + p.duration)} | {p.name} | {p.chapter or '—'} |")
    live = next((p for p in parts if p.name == "live"), None)
    if live is not None:
        run = getattr(live, "run_s", None)
        cut_s = getattr(live, "cut_s", 0.0)
        lines += [
            "",
            f"The live run plays in real time where something happens (the upload, the deal, the ZIP link) and at ×{getattr(live, 'speed', '?')} in between, with a \"Sped up ×{getattr(live, 'speed', '?')}\" badge on screen whenever it is. "
            + (f"The {cut_s:.0f} s the file dialog sat idle before the photo was chosen is cut, with a dissolve: it is before the photo → ZIP clock starts. " if cut_s else "")
            + (f"This take measured {run:.1f} s from choosing the file to the ZIP link; that is for the record only. " if run else "")
            + "In the voice-over, say \"about a minute\" (the claimed range is the timed runs in lib/claims.ts).",
        ]
    lines += [
        "",
        "## Laying the voice-over in",
        "",
        "- **Clipchamp / DaVinci Resolve / CapCut:** drop `" + PICTURE_NAME + "` on the video track and your recording (`vo.m4a` or `.wav`) on an audio track starting at 0:00; nudge each line to its timecode above, export 1080p.",
        "- **ffmpeg (one line, keeps the picture untouched):**",
        "",
        "  ```",
        f'  ffmpeg -i {PICTURE_NAME} -i vo.m4a -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -af apad -t {total:.2f} -movflags +faststart snap2shelf-walkthrough-final.mp4',
        "  ```",
        "",
        f"  (`-af apad -t {total:.2f}` pads a short recording with silence to the picture's full length.) For the captioned cut with voice, swap in `{CAPTIONED_NAME}`.",
        f"- Subtitles for the upload page: `{SRT_NAME}` (the captioned cut's text).",
        "",
        "## Files",
        "",
    ]
    for k, v in files.items():
        lines.append(f"- `{Path(v).name}`: {Path(v).stat().st_size / 1048576:.1f} MB, {probe_duration(Path(v)):.2f} s ({k})")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def probe_duration(path: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)], capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


# ─── Main ────────────────────────────────────────────────────────────────────


def default_out() -> Path:
    """The `video` folder next to the repo (for a worktree, the one beside the worktrees folder); never inside the repo."""
    for anc in ROOT.parents:
        cand = anc / "video"
        if cand.is_dir() and cand.resolve() != ROOT and ROOT not in cand.resolve().parents and not (cand / ".git").exists():
            return cand
    return ROOT.parent / "snap2shelf-video"


def default_photo() -> Path | None:
    for anc in [ROOT, *ROOT.parents]:
        cand = anc / "photos" / "decent" / "06_steel_bottle.png"
        if cand.exists():
            return cand
    return None


RECORDERS: dict[str, Callable] = {
    "title": rec_title,
    "outro": rec_outro,
    "studio": rec_studio,
    "kit": rec_kit,
    "shelf": rec_shelf,
    "arch": rec_arch,
    **{name: rec_chapter(name) for name in CHAPTER_OF},
}


def expand(only: str | None) -> list[str]:
    if not only:
        return list(GROUPS["all"])
    names: list[str] = []
    for tok in only.split(","):
        tok = tok.strip().lower()
        if not tok:
            continue
        for n_ in GROUPS.get(tok, [tok]):
            if n_ not in ORDER:
                raise SystemExit(f"unknown segment '{n_}' (segments: {', '.join(ORDER)}; groups: {', '.join(GROUPS)})")
            if n_ not in names:
                names.append(n_)
    return [n_ for n_ in ORDER if n_ in names]


async def record(names: list[str], args, work: Path) -> None:
    async with async_playwright() as pw:
        env = Env(pw, args.base, headed=not args.headless, work=work)
        await env.open()
        try:
            for name in names:
                log(f"── recording {name}")
                if name == "live":
                    photo = Path(args.photo) if args.photo else default_photo()
                    if not photo or not photo.exists():
                        raise RuntimeError("no photo for the live run (pass --photo)")
                    take = await rec_live(env, photo, args.allow_floor)
                else:
                    take = await RECORDERS[name](env)
                    # a stall mid-animation (the renderer busy rastering) reads as a hitch: take it again, keep the cleanest
                    if name != "arch":
                        best, best_h = take, hitches(take)
                        for attempt in range(args.retakes):
                            if not best_h:
                                break
                            log(f"{name}: stall(s) at {', '.join(f'{h[0]:.2f} s ({h[1] * 1000:.0f} ms)' for h in best_h)}; retake {attempt + 1}/{args.retakes}")
                            keep = best.dir.with_name(f"{name}.best")
                            shutil.rmtree(keep, ignore_errors=True)
                            best.dir.rename(keep)
                            best.dir = keep
                            again = await RECORDERS[name](env)
                            again_h = hitches(again)
                            if sum(h[2] for h in again_h) < sum(h[2] for h in best_h):
                                shutil.rmtree(keep, ignore_errors=True)
                                best, best_h = again, again_h
                            else:
                                shutil.rmtree(again.dir, ignore_errors=True)
                        take = best
                        if best_h:
                            log(f"{name}: kept a take with stall(s) at {', '.join(f'{h[0]:.2f} s' for h in best_h)} (the page itself pauses there)")
                        take.meta["hitches"] = best_h
                if len(take.frames) < (1 if name == "arch" else 8):
                    raise RuntimeError(f"the {name} take has only {len(take.frames)} frames; the screencast did not run")
                take.meta["base"] = env.base
                take.meta["recorded"] = time.strftime("%Y-%m-%d %H:%M:%S")
                take.save()
                final = work / name
                shutil.rmtree(final, ignore_errors=True)
                take.save()
                take.dir.rename(final)
                take.dir = final
                log(f"{name}: {take.stats()}")
            log("app API requests while recording: " + (", ".join(f"{k} x{v}" for k, v in sorted(env.api_calls.items())) or "none"))
        finally:
            await env.close()


def main() -> int:
    ap = argparse.ArgumentParser(description="Record and cut the Snap2Shelf walkthrough video (see the module docstring).")
    ap.add_argument("--base", default=os.environ.get("MEDIA_BASE_URL", BASE_DEFAULT), help="site to record (default: production)")
    ap.add_argument("--out", default=None, help="output folder (default: the 'video' folder beside the repo)")
    ap.add_argument("--work", default=None, help="takes folder (default: <out>/work)")
    ap.add_argument("--only", default=None, help="re-record only these segments/groups, comma-separated (default: every segment except live)")
    ap.add_argument("--render-only", action="store_true", help="record nothing: re-cut and render the kept takes")
    ap.add_argument("--record-only", action="store_true", help="record, but don't cut or render")
    ap.add_argument("--live", action="store_true", help="allow the live segment to record: ONE real upload on --base (spends ~0.35 transformation credits)")
    ap.add_argument("--allow-floor", action="store_true", help="record the live run even if it would cross the transformation-credit floor")
    ap.add_argument("--photo", default=None, help="photo for the live run (default: photos/decent/06_steel_bottle.png beside the repo)")
    ap.add_argument("--skip-live", action="store_true", help="cut the edit without the live segment even if a live take exists (the Kit reel chapter takes its place)")
    ap.add_argument("--retakes", type=int, default=2, help="re-record a segment up to N more times if it shows a render stall mid-animation (default 2)")
    ap.add_argument("--headless", action="store_true", help="headless Chromium (smaller frame rate, ~28 fps; default is headed, parked off-screen)")
    ap.add_argument("--preset", default="slow", help="x264 preset (default slow)")
    ap.add_argument("--crf", type=int, default=16, help="x264 CRF (default 16)")
    args = ap.parse_args()

    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            log(f"{tool} is not on PATH (https://ffmpeg.org/download.html)")
            return 2
    out = Path(args.out) if args.out else default_out()
    if ROOT in out.resolve().parents or out.resolve() == ROOT:
        log(f"refusing to write video files inside the repo ({out}); pass --out")
        return 2
    work = Path(args.work) if args.work else out / "work"
    work.mkdir(parents=True, exist_ok=True)
    claims = load_claims()
    try:
        if not args.render_only:
            names = expand(args.only)
            if "live" in names and not args.live:
                log("skipping the live segment: it uploads a real photo; pass --live to record it")
                names.remove("live")
            if names:
                asyncio.run(record(names, args, work))
            if args.record_only:
                return 0
        takes: dict[str, Take] = {}
        missing = []
        for name in ORDER:
            if (work / name / "take.json").exists():
                takes[name] = Take.load(work / name)
            else:
                missing.append(name)
        skip_live = args.skip_live or "live" in missing
        if "live" in missing:
            log("no live take yet: cutting without the live run (the Kit reel chapter holds its place). Record it with --only live --live")
        need = [n_ for n_ in missing if n_ != "live" and not (n_ == "reel" and not skip_live)]
        if need:
            raise RuntimeError(f"no take yet for: {', '.join(need)}. Record with --only {','.join(need)}")
        parts = build_edit(takes, claims, skip_live=skip_live)
        total = assemble(parts)
        log(f"edit: {len(parts)} segments, {tc(total)} ({total:.1f} s)")
        for p in parts:
            log(f"  {tc(p.start):>7} – {tc(p.start + p.duration):>7}  {p.name:7s} {p.chapter}")
        files = render(parts, total, out, work, args.preset, args.crf)
        write_srt(parts, out / SRT_NAME)
        write_cue_sheet(parts, total, out / CUE_NAME, files, {"base": args.base})
        for k, v in files.items():
            log(f"wrote {v}: {v.stat().st_size / 1048576:.1f} MB, {probe_duration(v):.2f} s")
        log(f"wrote {out / CUE_NAME} and {out / SRT_NAME}; review sheets in {work / 'review'}")
        return 0
    except KeyboardInterrupt:
        log("interrupted")
        return 130
    except Exception as e:
        log(f"FAILED: {type(e).__name__}: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
