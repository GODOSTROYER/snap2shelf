"""
Record the README demo GIF and the social MP4 from the live site, reproducibly.

    npm run media:gif                         # production, writes docs/media/
    python scripts/media/capture.py --base http://localhost:3000 --keep-frames

What it records (1280x720, device scale 1, Chromium headless):

  1. /studio?sample=shmessy1  the zero-API sample replay: the cluttered-counter
     sample photo -> cut-out -> Scene DNA -> the QA gate rejecting a floating
     placement and fixing it -> the pack -> the kit cards dealing onto the shelf
  2. the X-ray sheet of the feed post (the one Cloudinary URL that renders it)
  3. /shelf/demo-studio       the public shop shelf

Every page is loaded once as a warm-up (images decoded, reel and shelf images
in the HTTP cache), then recorded with the Chrome DevTools screencast. Each
frame carries the time it was painted, so the edit is resampled to a fixed
frame rate from real paint times, and trimmed to marks the page itself reports
(the pipeline rail's steps, the QA story, the shelf's deal), never to guessed
sleeps. If a mark is missing (the UI changed), it falls back to fixed offsets
and says so.

Outputs (docs/media/):
  demo.gif          800 px wide, 12 fps, loops, <= 6 MB (palettegen/paletteuse)
  demo-social.mp4   1280x720 H.264 yuv420p, faststart, no audio, <= 30 s
  poster.png        the first frame, 1280x720

Budget: the pages are pre-rendered and their images already derived, so this
makes no generation, AI Vision or Admin API calls; it only loads three pages
(twice each). It never clicks anything that writes.

Needs: Python 3.10+, `pip install playwright pillow`, `python -m playwright
install chromium`, and ffmpeg on PATH.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import bisect
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

try:
    from playwright.async_api import async_playwright, Page, TimeoutError as PwTimeout
except ImportError:  # pragma: no cover
    sys.exit("capture.py needs Playwright for Python: pip install playwright && python -m playwright install chromium")
try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:  # pragma: no cover
    sys.exit("capture.py needs Pillow: pip install pillow")

ROOT = Path(__file__).resolve().parents[2]
W, H = 1280, 720
FPS = 30  # master and MP4 frame rate
GIF_FPS = 12
GIF_WIDTH = 800
GIF_MAX_BYTES = 6 * 1024 * 1024
MP4_MAX_S = 30.0

STUDIO_PATH = "/studio?sample=shmessy1"
SHOP_PATH = "/shelf/demo-studio"

# Brand tokens (app/globals.css): marigold accent, paper text, studio black.
MARIGOLD = (245, 165, 36)
PAPER = (244, 239, 231)
DIM = (214, 205, 192)
INK = (14, 12, 10)


def log(msg: str) -> None:
    print(f"[media] {msg}", flush=True)


# ─── In-page mark recorder ───────────────────────────────────────────────────
# Runs in every document before the app's own scripts. It records, with the
# page's wall clock (epoch ms, the same clock the screencast stamps frames
# with), the first time each state of the replay is on screen.
MARKS_JS = r"""
(() => {
  if (window.__s2sMarks) return;
  const marks = (window.__s2sMarks = {});
  const mark = (k) => { if (!(k in marks)) marks[k] = performance.timeOrigin + performance.now(); };
  let lastText = 0;
  const tick = () => {
    try {
      if (document.querySelector('h1')) mark('painted');
      const rail = document.querySelector('ol[aria-label="Progress"]');
      if (rail && rail.getBoundingClientRect().height > 0) {
        mark('rail');
        const items = Array.from(rail.querySelectorAll(':scope > li'));
        const i = items.findIndex((li) => li.getAttribute('aria-current') === 'step');
        if (i >= 0) mark('step' + i);
        if (!('photo_sharp' in marks)) {
          // the stage photo has finished its focus-in (no blur left on it or its wrappers)
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
      }
    } catch (e) { /* never break the page */ }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
"""

# A visible pointer for the one click the GIF shows (headless has no cursor).
CURSOR_JS = r"""
(() => {
  if (document.getElementById('__s2s_cursor')) return;
  const c = document.createElement('div');
  c.id = '__s2s_cursor';
  c.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M4 2.5v17.2l4.6-4.2 2.9 6.6 3-1.3-2.9-6.5 6.3-.3z" fill="#f4efe7" stroke="#0e0c0a" stroke-width="1.4" stroke-linejoin="round"/></svg><span></span>';
  c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(1180px,420px);transition:transform 650ms cubic-bezier(.3,.7,.2,1),opacity 250ms;opacity:0;filter:drop-shadow(0 2px 3px rgb(0 0 0/.6))';
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


# ─── Screencast recorder ─────────────────────────────────────────────────────


@dataclass
class Recorder:
    """Chrome DevTools screencast: every painted frame, as JPEG, with its paint time."""

    page: Page
    frames_dir: Path
    frames: list[tuple[float, Path]] = field(default_factory=list)
    _cdp: object = None
    _n: int = 0
    _tasks: set = field(default_factory=set)

    async def start(self) -> None:
        if self._cdp is None:
            self._cdp = await self.page.context.new_cdp_session(self.page)
            self._cdp.on("Page.screencastFrame", self._on_frame)
        await self._cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 92, "maxWidth": W, "maxHeight": H, "everyNthFrame": 1})

    async def stop(self) -> None:
        if self._cdp is not None:
            try:
                await self._cdp.send("Page.stopScreencast")
            except Exception:
                pass
            await asyncio.sleep(0.15)
            if self._tasks:
                await asyncio.gather(*self._tasks, return_exceptions=True)

    async def detach(self) -> None:
        await self.stop()
        if self._cdp is not None:
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
        path = self.frames_dir / f"f{self._n:05d}.jpg"
        self._n += 1
        path.write_bytes(base64.b64decode(params["data"]))
        self.frames.append((float(ts), path))
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


async def settle(page: Page) -> None:
    try:
        await page.wait_for_load_state("networkidle", timeout=15000)
    except PwTimeout:
        pass


# ─── Capture ─────────────────────────────────────────────────────────────────


@dataclass
class Take:
    name: str
    frames: list[tuple[float, Path]]
    marks: dict[str, float]
    t0: float  # wall time the segment was started (for fallbacks)


async def open_xray(page: Page, *, show_cursor: bool) -> float | None:
    """Point at an X-ray button and press it. Returns the press time.

    Prefers the stage's "See the URL" (the hero: scene, shadows, product layer,
    light-match, all in one URL), then any shelf card's X-ray button."""
    candidates = [
        page.locator("button", has_text="See the URL"),
        page.locator('button[aria-label^="X-ray"][aria-label*="Feed post"]'),
        page.locator('button[aria-label^="X-ray"]'),
    ]
    btn = None
    for c in candidates:
        if await c.count():
            btn = c.first
            break
    if btn is None:
        return None
    await btn.scroll_into_view_if_needed()
    box = await btn.bounding_box()
    if not box:
        return None
    x, y = box["x"] + min(22, box["width"] / 2), box["y"] + box["height"] / 2
    if show_cursor:
        await page.evaluate(CURSOR_JS)
        await page.evaluate("() => window.__s2sCursor.show()")
        await asyncio.sleep(0.2)
        await page.evaluate(f"() => window.__s2sCursor.moveTo({x - 4:.0f}, {y - 3:.0f})")
        await asyncio.sleep(0.75)
        await page.evaluate("() => window.__s2sCursor.click()")
        await asyncio.sleep(0.22)  # the click ring shows before the sheet starts to open
    pressed = time.time()
    await btn.click()
    if show_cursor:
        await asyncio.sleep(0.25)
        await page.evaluate("() => window.__s2sCursor.hide()")
    try:
        await page.wait_for_selector('[role="dialog"]', state="visible", timeout=5000)
    except PwTimeout:
        return None
    await decoded(page, 5)
    return pressed


async def scroll_top(page: Page) -> None:
    await page.evaluate("() => window.scrollTo({ top: 0, behavior: 'smooth' })")
    try:
        await page.wait_for_function("() => window.scrollY === 0", timeout=4000)
    except PwTimeout:
        await page.evaluate("() => window.scrollTo(0, 0)")
    await asyncio.sleep(0.15)


# Frame the shop so the title and all four tiles sit above the caption band.
# Layout positions (offsetTop), not client rects: the entrance animation is still moving things.
SHOP_FRAME_JS = r"""
() => {
  const abs = (e) => { let y = 0; for (; e; e = e.offsetParent) y += e.offsetTop; return y; };
  const h1 = document.querySelector('h1');
  const imgs = Array.from(document.images).filter((i) => i.offsetWidth > 150);
  if (!h1 || !imgs.length) return 0;
  const bottom = Math.max(...imgs.map((i) => abs(i) + i.offsetHeight));
  const y = Math.round(Math.max(0, Math.min(bottom - (innerHeight - 100), abs(h1) - 48)));
  window.scrollTo(0, y);
  return y;
}
"""

# Scroll the open X-ray sheet so the colour-coded URL sits right under its title.
SHEET_URL_JS = r"""
() => {
  const d = document.querySelector('[role="dialog"]');
  if (!d) return null;
  const hits = Array.from(d.querySelectorAll('*')).filter((e) => /^\s*(https:\/\/)?res\.cloudinary\.com\//.test(e.textContent || '') && e.getBoundingClientRect().height > 40);
  const url = hits[hits.length - 1];
  if (!url) return null;
  let box = url.parentElement;
  while (box && box !== d && !(/(auto|scroll)/.test(getComputedStyle(box).overflowY) && box.scrollHeight > box.clientHeight)) box = box.parentElement;
  if (!box || box === d && !(box.scrollHeight > box.clientHeight)) return 0;
  const dy = url.getBoundingClientRect().top - box.getBoundingClientRect().top - 14;
  box.scrollTop += dy;
  return Math.round(dy);
}
"""


async def capture(base: str, work: Path, headed: bool) -> list[Take]:
    studio_url = base.rstrip("/") + STUDIO_PATH
    shop_url = base.rstrip("/") + SHOP_PATH
    takes: list[Take] = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=not headed, args=["--hide-scrollbars", "--disable-lcd-text"])
        try:
            ctx = await browser.new_context(
                viewport={"width": W, "height": H},
                device_scale_factor=1,  # the site's fixed image widths: no new derivatives
                color_scheme="dark",
                reduced_motion="no-preference",
                locale="en-IN",
            )
            await ctx.add_init_script(MARKS_JS)
            page = await ctx.new_page()
            page.set_default_timeout(60000)
            # every app API request, so a run shows what it touched (the replay should need none)
            api_calls: dict[str, int] = {}

            def on_request(req) -> None:
                path = req.url.split("?", 1)[0]
                if "/api/" in path:
                    key = f"{req.method} {path[path.index('/api/'):]}"
                    api_calls[key] = api_calls.get(key, 0) + 1

            page.on("request", on_request)

            # ── Warm-up: every image the recording will show lands in the HTTP cache.
            log(f"warm-up: {studio_url}")
            await page.goto(studio_url, wait_until="load")
            if not await wait_mark(page, "dealt", 75):
                log("warm-up: the shelf never finished dealing (continuing)")
            await settle(page)
            await asyncio.sleep(1.0)
            await page.evaluate("() => { document.querySelectorAll('section[data-kit] img').forEach((i) => (i.loading = 'eager')); }")
            await settle(page)
            if await open_xray(page, show_cursor=False):
                await asyncio.sleep(0.6)
                await page.keyboard.press("Escape")
            log(f"warm-up: {shop_url}")
            await page.goto(shop_url, wait_until="load")
            await settle(page)
            await page.evaluate("() => window.scrollTo(0, document.documentElement.scrollHeight)")
            await settle(page)
            log(f"warm-up: shop images decoded {await decoded(page)}")

            # ── 1+2. Studio replay, then the X-ray, on one page.
            frames_dir = work / "studio"
            frames_dir.mkdir(parents=True, exist_ok=True)
            await page.goto("about:blank")
            rec = Recorder(page, frames_dir)
            await rec.start()
            t0 = time.time()
            log("recording: studio sample replay")
            await page.goto(studio_url, wait_until="commit")
            got_dealt = await wait_mark(page, "dealt", 75)
            if not got_dealt:
                log("WARNING: no 'dealt' mark; the shelf deal will be cut on fixed timings")
            await asyncio.sleep(1.0)  # let the last card settle and the reel start
            log(f"recording: studio images decoded {await decoded(page)}")
            extra: dict[str, float] = {"up_start": time.time()}
            await scroll_top(page)
            extra["up_end"] = time.time()
            pressed = await open_xray(page, show_cursor=True)
            if pressed is None:
                log("WARNING: could not open an X-ray sheet; the edit skips the X-ray beat")
            else:
                extra["xray_press"] = pressed
                await asyncio.sleep(0.3)
                dy = await page.evaluate(SHEET_URL_JS)
                rect = await page.evaluate("() => { const r = document.querySelector('[role=\"dialog\"]')?.getBoundingClientRect(); return r ? [r.left, r.top, r.right, r.bottom] : null; }")
                if rect:
                    extra["sheet_left"], extra["sheet_top"], extra["sheet_right"] = rect[0], rect[1], rect[2]
                await asyncio.sleep(0.1)
                extra["sheet_ready"] = time.time()
                log(f"recording: X-ray open, sheet scrolled {dy}px to its URL")
                await asyncio.sleep(2.8)
                extra["xray_end"] = time.time()
            await rec.detach()
            m = await marks_of(page)
            m.update(extra)
            takes.append(Take("studio", sorted(rec.frames), m, t0))
            rail = m.get("rail", t0)
            times = sorted(((k, v) for k, v in m.items() if not k.startswith("sheet_") or k == "sheet_ready"), key=lambda kv: kv[1])
            log(f"studio: {len(rec.frames)} frames; marks (s after the rail): " + ", ".join(f"{k} {v - rail:+.2f}" for k, v in times))

            # ── 3. The shop shelf, framed so the title and every tile are in view.
            frames_dir = work / "shop"
            frames_dir.mkdir(parents=True, exist_ok=True)
            await page.goto("about:blank")
            rec = Recorder(page, frames_dir)
            await rec.start()
            t0 = time.time()
            log("recording: shop shelf")
            await page.goto(shop_url, wait_until="commit")
            await page.wait_for_load_state("domcontentloaded")
            y = await page.evaluate(SHOP_FRAME_JS)
            state = await decoded(page)
            ready = time.time()
            log(f"recording: shop scrolled to {y}px, images decoded {state}")
            await asyncio.sleep(3.6)
            end = time.time()
            await rec.detach()
            sm = await marks_of(page)
            takes.append(Take("shop", sorted(rec.frames), {"painted": sm.get("painted", ready - 0.4), "ready": ready, "end": end}, t0))
            log(f"shop: {len(rec.frames)} frames")
            log("app API requests during the run: " + (", ".join(f"{k} x{n}" for k, n in sorted(api_calls.items())) or "none"))
        finally:
            await browser.close()
    return takes


# ─── Edit ────────────────────────────────────────────────────────────────────


@dataclass
class Clip:
    take: Take
    start: float  # source wall time
    end: float
    speed: float = 1.0
    zoom: tuple[float, float, float, float] | None = None  # (x, y, w, h) crop, in 1280x720 px
    zoom_from: float | None = None  # source time the zoom starts (None: zoomed from the first frame)
    zoom_s: float = 0.0  # 0 = a cut; > 0 eases in (every eased frame is a full GIF frame)
    xfade: bool = True  # dissolve into this clip when it jumps in time or place

    @property
    def duration(self) -> float:
        return (self.end - self.start) / self.speed


@dataclass
class Caption:
    t0: float  # output seconds
    t1: float
    title: str
    detail: str = ""


def build_edit(takes: list[Take]) -> tuple[list[Clip], list[Caption]]:
    """Cut the takes into the loop. All times are the page's own marks, so a slower or
    faster deploy moves the cuts with it; only a missing mark falls back to an offset."""
    studio = next(t for t in takes if t.name == "studio")
    shop = next(t for t in takes if t.name == "shop")
    m = studio.marks
    first_frame = studio.frames[0][0] if studio.frames else studio.t0
    rail = m.get("rail") or first_frame + 1.0

    def at(key: str, fallback: float) -> float:
        if key in m:
            return m[key]
        log(f"WARNING: mark '{key}' missing, using a fixed offset")
        return rail + fallback

    s_stage = at("step2", 2.2)  # the photo is on stage through Fix and Cut out
    s_caught = at("qa_caught", 6.6)  # QA's first verdict: rejected
    s_fixed = at("qa_fixed", 10.8)  # the re-check approves the fixed placement
    s_view = at("shelf_in_view", 13.0)  # the page has scrolled to the shelf
    s_dealt = at("dealt", 15.5)  # every card has landed

    clips: list[Clip] = []
    caps: list[Caption] = []
    t = 0.0

    def add(clip: Clip) -> tuple[float, float]:
        nonlocal t
        clips.append(clip)
        span = (t, t + clip.duration)
        t += clip.duration
        return span

    s_photo = min(m.get("photo_sharp", rail + 0.6), s_stage - 1.2)  # the photo has focused in (the poster frame)
    a0, a1 = add(Clip(studio, s_photo + 0.05, s_stage, speed=1.0))  # the sample photo: Fix, Cut out
    b0, b1 = add(Clip(studio, s_stage, s_caught - 0.35, speed=1.4))  # Stage, Scene DNA, Light-match
    c0, c1 = add(Clip(studio, s_caught - 0.35, s_fixed + 0.9, speed=1.25))  # QA rejects, fixes, approves
    d0, d1 = add(Clip(studio, s_fixed + 0.9, s_view, speed=1.8))  # the pack counts in, scroll to the shelf
    e0, e1 = add(Clip(studio, s_view, s_dealt + 0.6, speed=1.1))  # the cards deal onto the shelf
    # the caption for the photo is already up on frame 0 (the poster), so it starts before the clip
    caps.append(Caption(a0 - 1.0, a1, "One product photo", "Sample input photo: an AI-generated test image, not a real seller's"))
    caps.append(Caption(b0, c0, "Cut out once, set on a library scene", "Scene DNA: AI Vision already mapped the surface and the light"))
    caps.append(Caption(c0, c1, "QA gate: AI Vision flags a floating bottle", "The studio sets it down on the surface, checks again, and approves it"))
    shelf_end = e1

    press, up_end, x_end = m.get("xray_press"), m.get("up_end"), m.get("xray_end")
    sheet = m.get("sheet_ready", (press or 0) + 0.8)
    if press and up_end and x_end:
        # cut (no scroll: every scrolled frame is a full GIF frame) back to the stage, point, press
        g0, g1 = add(Clip(studio, up_end, press + 0.4, speed=1.3, xfade=False))
        # cut to a close-up of the open sheet, so the URL reads at GIF size
        # a 16:9 close-up, 720 px wide, on the sheet's top right (the sheet sits on the right edge)
        right = min(float(W), m.get("sheet_right", W - 12.0) + 12)
        zx = max(0.0, min(W - 720.0, right - 720))
        zy = max(0.0, min(H - 405.0, m.get("sheet_top", 12.0) + 6))
        h0, h1 = add(Clip(studio, sheet + 0.05, min(x_end, sheet + 2.5), speed=1.0, zoom=(zx, zy, 720, 405), xfade=False))
        caps.append(Caption(g0, h1, "Every image is one Cloudinary URL", "X-ray shows each step: scene, shadows, your product as a layer, light"))
    caps.append(Caption(d0, shelf_end, "One approved hero, every channel format", "Story, banner, marketplace white, WhatsApp tile, colour variants, offer, reel"))

    # a cut, not a dissolve: the shelf's own entrance (it rises in from the dark) is the transition
    painted = shop.marks.get("painted", shop.marks.get("ready", shop.t0 + 1.5) - 0.4)
    end = min(shop.marks.get("end", painted + 4.0), painted + 3.1)
    s0, s1 = add(Clip(shop, painted + 0.03, end, speed=1.0, xfade=False))
    caps.append(Caption(s0 + 0.5, s1 + 1.0, "Published as a shop shelf", "snap2shelf.vercel.app/shelf/demo-studio  ·  sample products"))
    return clips, caps


def save_takes(takes: list[Take], work: Path) -> None:
    data = [
        {"name": t.name, "t0": t.t0, "marks": t.marks, "frames": [[ts, os.path.relpath(p, work)] for ts, p in t.frames]}
        for t in takes
    ]
    (work / "takes.json").write_text(json.dumps(data), encoding="utf-8")


def load_takes(work: Path) -> list[Take]:
    data = json.loads((work / "takes.json").read_text(encoding="utf-8"))
    return [Take(d["name"], [(ts, work / p) for ts, p in d["frames"]], d["marks"], d["t0"]) for d in data]


# ─── Render ──────────────────────────────────────────────────────────────────


def load_font(size: int, bold: bool) -> ImageFont.FreeTypeFont:
    names = (
        ["C:/Windows/Fonts/seguisb.ttf", "C:/Windows/Fonts/segoeuib.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]
        if bold
        else ["C:/Windows/Fonts/segoeui.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
    )
    for n in names:
        if os.path.exists(n):
            return ImageFont.truetype(n, size)
    return ImageFont.load_default(size=size)


class CaptionPainter:
    def __init__(self) -> None:
        self.title = load_font(31, True)
        self.detail = load_font(22, False)
        self.cache: dict[tuple[str, str], Image.Image] = {}

    def pill(self, c: Caption) -> Image.Image:
        key = (c.title, c.detail)
        if key in self.cache:
            return self.cache[key]
        pad_x, pad_y, gap = 30, 14, 4
        tb = self.title.getbbox(c.title)
        db = self.detail.getbbox(c.detail) if c.detail else (0, 0, 0, 0)
        tw, th = tb[2] - tb[0], 32
        dw, dh = (db[2] - db[0], 24) if c.detail else (0, 0)
        w = max(tw, dw) + pad_x * 2 + 16
        h = pad_y * 2 + th + (gap + dh if c.detail else 0) + 6
        im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        d.rounded_rectangle((0, 0, w - 1, h - 1), radius=18, fill=INK + (238,), outline=(255, 255, 255, 30), width=1)
        d.rounded_rectangle((pad_x - 14, pad_y + 6, pad_x - 10, pad_y + th - 2), radius=2, fill=MARIGOLD + (255,))
        d.text((pad_x + 4 - tb[0], pad_y - 2), c.title, font=self.title, fill=PAPER + (255,))
        if c.detail:
            d.text((pad_x + 4 - db[0], pad_y + th + gap + 2), c.detail, font=self.detail, fill=DIM + (255,))
        self.cache[key] = im
        return im

    def paint(self, frame: Image.Image, caps: list[Caption], t: float) -> Image.Image:
        for c in caps:
            if not (c.t0 <= t < c.t1):
                continue
            fade = 0.16
            a = min(1.0, (t - c.t0) / fade, (c.t1 - t) / fade)
            p = self.pill(c)
            if a < 1:
                p = p.copy()
                p.putalpha(p.getchannel("A").point(lambda v: int(v * a)))
            x = (W - p.width) // 2
            y = H - p.height - 18 + int((1 - a) * 8)
            frame.alpha_composite(p, (x, y))
        return frame


def ease(u: float) -> float:
    u = max(0.0, min(1.0, u))
    return u * u * (3 - 2 * u)


class FramePicker:
    def __init__(self, frames: list[tuple[float, Path]]):
        self.times = [f[0] for f in frames]
        self.paths = [f[1] for f in frames]
        self._cache: tuple[Path, Image.Image] | None = None

    def at(self, ts: float) -> Image.Image:
        """The frame on screen at wall time ts: the last one painted at or before it."""
        i = max(0, bisect.bisect_right(self.times, ts) - 1)
        path = self.paths[i]
        if self._cache and self._cache[0] == path:
            return self._cache[1]
        im = Image.open(path).convert("RGB")
        if im.size != (W, H):
            im = im.resize((W, H), Image.LANCZOS)
        self._cache = (path, im)
        return im


def render_master(clips: list[Clip], caps: list[Caption], out: Path) -> tuple[int, float, Image.Image]:
    pickers = {id(c.take): FramePicker(c.take.frames) for c in clips}
    painter = CaptionPainter()
    total = sum(c.duration for c in clips)
    xfade = 0.25  # crossfade between clips from different moments
    n = int(round(total * FPS))
    cmd = [
        "ffmpeg", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
        "-c:v", "libx264rgb", "-preset", "ultrafast", "-crf", "0", str(out),
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    starts = []
    acc = 0.0
    for c in clips:
        starts.append(acc)
        acc += c.duration

    def source_frame(ci: int, local: float) -> Image.Image:
        c = clips[ci]
        ts = c.start + local * c.speed
        im = pickers[id(c.take)].at(ts)
        if c.zoom:
            since = ts - (c.zoom_from if c.zoom_from is not None else c.start)
            u = (1.0 if since >= 0 else 0.0) if c.zoom_s <= 0 else ease(since / c.zoom_s)
            if u > 0:
                zx, zy, zw, zh = c.zoom
                box = (zx * u, zy * u, zx * u + W + (zw - W) * u, zy * u + H + (zh - H) * u)
                im = im.resize((W, H), Image.LANCZOS, box=box)
        return im

    first: Image.Image | None = None
    for k in range(n):
        t = k / FPS
        ci = max(0, bisect.bisect_right(starts, t) - 1)
        local = t - starts[ci]
        im = source_frame(ci, local)
        # crossfade into the next clip when the cut jumps in time or place
        if ci + 1 < len(clips) and starts[ci + 1] - t < xfade:
            nxt = clips[ci + 1]
            jump = nxt.take is not clips[ci].take or abs(nxt.start - clips[ci].end) > 0.05
            if jump and nxt.xfade:
                u = 1 - (starts[ci + 1] - t) / xfade
                im = Image.blend(im, source_frame(ci + 1, 0.0), ease(u))
        frame = painter.paint(im.convert("RGBA"), caps, t).convert("RGB")
        if k == 0:
            first = frame.copy()
        proc.stdin.write(frame.tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        raise RuntimeError("ffmpeg failed while writing the master")
    assert first is not None
    return n, total, first


def run(cmd: list[str]) -> None:
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"{cmd[0]} failed:\n{r.stderr[-2000:]}")


def probe_duration(path: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)], capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def encode(master: Path, out_dir: Path, work: Path) -> dict[str, tuple[int, float]]:
    out_dir.mkdir(parents=True, exist_ok=True)
    mp4 = out_dir / "demo-social.mp4"
    gif = out_dir / "demo.gif"
    tmp_mp4, tmp_gif = work / "demo-social.mp4", work / "demo.gif"
    run([
        "ffmpeg", "-loglevel", "error", "-y", "-i", str(master),
        "-vf", f"scale={W}:-2:flags=lanczos,format=yuv420p",
        "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-profile:v", "high", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", "-an", str(tmp_mp4),
    ])
    # A single palette for the whole loop (no flicker between frames), error-diffusion
    # dither for the photos; fall back to coarser settings only if it runs over 6 MB.
    ladder = [
        ("full", "sierra2_4a", 256),
        ("full", "bayer:bayer_scale=3", 256),
        ("diff", "bayer:bayer_scale=2", 192),
        ("diff", "bayer:bayer_scale=1", 128),
    ]
    size = 0
    for stats, dither, colors in ladder:
        vf = (
            f"fps={GIF_FPS},scale={GIF_WIDTH}:-1:flags=lanczos,split[a][b];"
            f"[a]palettegen=max_colors={colors}:stats_mode={stats}[p];"
            f"[b][p]paletteuse=dither={dither}:diff_mode=rectangle"
        )
        run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(master), "-vf", vf, "-loop", "0", str(tmp_gif)])
        size = tmp_gif.stat().st_size
        log(f"gif: palette {stats}/{colors}, dither {dither}: {size / 1048576:.2f} MB")
        if size <= GIF_MAX_BYTES:
            break
    if size > GIF_MAX_BYTES:
        raise RuntimeError(f"demo.gif is {size / 1048576:.1f} MB even at the coarsest settings (limit 6 MB); shorten the edit")
    shutil.copyfile(tmp_mp4, mp4)
    shutil.copyfile(tmp_gif, gif)
    return {
        "demo.gif": (gif.stat().st_size, probe_duration(gif)),
        "demo-social.mp4": (mp4.stat().st_size, probe_duration(mp4)),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Record docs/media/demo.gif, demo-social.mp4 and poster.png from the live site.")
    ap.add_argument("--base", default=os.environ.get("MEDIA_BASE_URL", "https://snap2shelf.vercel.app"), help="site to record (default: production)")
    ap.add_argument("--out", default=str(ROOT / "docs" / "media"), help="output directory (default: docs/media)")
    ap.add_argument("--keep-frames", action="store_true", help="keep the raw screencast frames and the lossless master")
    ap.add_argument("--headed", action="store_true", help="show the browser while recording")
    ap.add_argument("--reuse", metavar="DIR", help="re-edit the takes kept in DIR by an earlier --keep-frames run (no browser)")
    args = ap.parse_args()

    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            log(f"{tool} is not on PATH (https://ffmpeg.org/download.html)")
            return 2

    keep = args.keep_frames or bool(args.reuse)
    work = Path(args.reuse) if args.reuse else Path(tempfile.mkdtemp(prefix="s2s-media-"))
    try:
        if args.reuse:
            takes = load_takes(work)
            log(f"re-editing the takes in {work}")
        else:
            takes = asyncio.run(capture(args.base, work, args.headed))
            save_takes(takes, work)
        for t in takes:
            if len(t.frames) < 10:
                raise RuntimeError(f"the {t.name} take has only {len(t.frames)} frames; the screencast did not run")
        clips, caps = build_edit(takes)
        total = sum(c.duration for c in clips)
        if total > MP4_MAX_S:
            raise RuntimeError(f"the edit runs {total:.1f} s (limit {MP4_MAX_S:.0f} s)")
        log(f"edit: {len(clips)} clips, {total:.1f} s")
        master = work / "master.mkv"
        n, total, first = render_master(clips, caps, master)
        out = Path(args.out)
        out.mkdir(parents=True, exist_ok=True)
        first.save(out / "poster.png", optimize=True)
        results = encode(master, out, work)
        rel = lambda p: os.path.relpath(p, ROOT) if str(p).startswith(str(ROOT)) else str(p)
        for name, (size, dur) in results.items():
            log(f"wrote {rel(out / name)}: {size / 1048576:.2f} MB, {dur:.1f} s")
        log(f"wrote {rel(out / 'poster.png')}: {(out / 'poster.png').stat().st_size / 1024:.0f} KB")
        for c in caps:
            log(f"  {c.t0:5.1f}-{c.t1:5.1f} s  {c.title}")
        if keep:
            log(f"kept the takes and the master in {work} (re-edit with --reuse)")
        return 0
    except KeyboardInterrupt:
        log("interrupted")
        return 130
    except Exception as e:  # clean, readable failure; the finally block tidies up
        log(f"FAILED: {type(e).__name__}: {e}")
        return 1
    finally:
        if not keep:
            shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
