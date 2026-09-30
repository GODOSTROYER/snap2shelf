"""
Voice-over, music bed and sound effects for the Snap2Shelf walkthrough, mixed to
YouTube loudness and muxed onto the picture-locked edit, reproducibly.

    npm run media:audio                                # everything (TTS comes from the cache after the first run)
    python scripts/media/voiceover.py --audition       # audition the prebuilt voices on the first line (1 request each, cached)
    python scripts/media/voiceover.py --voice Sulafat  # use another voice
    python scripts/media/voiceover.py --offline        # never call Gemini: a cache miss is an error
    python scripts/media/voiceover.py --offline --allow-missing --no-transcribe   # a *-preview mix with what is voiced so far
    python scripts/media/voiceover.py --no-transcribe  # skip the one-call intelligibility check

Quota: the free tier allows 10 TTS requests a day per model per key. Lines already voiced on
their own are reused from the cache; the rest go two consecutive lines per request, cut apart at
the pause between them (a take that doesn't cut cleanly is asked for again, one line each).

What it does, in order:

  1. Reads VO_CUE_SHEET.md (written by walkthrough.py for THIS cut): each line's timecode and
     window, and the Segments table (the dissolves the whooshes sit on).
  2. Narration: the cue sheet's lines with three honest rewrites (a neutral narrator never
     claims to be a person or the builder; the rupee figure read in full) and TTS-only
     spellings ("Snap2Shelf" -> "Snap-to-Shelf", "ZIP" -> "zip", the URL spelled out).
  3. Gemini TTS (gemini-3.8-flash-tts through the Interactions API, one prebuilt voice, the
     style as a speech_metadata annotation), ONE API key, paced and retried with backoff on
     429. Every take is cached on disk, keyed by model + voice + style + text, so a re-run
     makes no requests.
  4. Each clip: silence trimmed, 48 kHz, 80 Hz high-pass, de-essed, gently compressed,
     loudness-matched; placed at its timecode. A clip that overruns its window is
     re-generated at a brisker pace, then time-stretched (atempo <= 1.12).
  5. An original music bed, synthesised here (numpy/scipy, nothing downloaded): detuned-saw
     pads, an FM pluck arpeggio, sub bass, soft kick/shaker/rim at 100 BPM in D major,
     convolution reverb (synthetic IR), evolving by segment (lift at the live run and outro),
     ducked under the voice with a smooth envelope.
  6. Sound effects, also synthesised: whooshes on the segment dissolves, a two-note chime on
     the studio's QA "Approved", card ticks as each kit deals onto its shelf, a soft pop as
     the outro's QR code appears.
  7. Mix -> true-peak safety limiter -> ffmpeg loudnorm, two-pass, linear: -14 LUFS, <= -1 dBTP.
  8. Mux onto both cuts (video stream copied, AAC 224 kb/s, faststart); ebur128 report,
     timeline table, waveform/spectrogram PNG, one Gemini call to transcribe the voice stem
     back and diff it against the script.

Inputs/outputs live in the "video" folder beside the repo (same rule as walkthrough.py; never
inside the repo). One API key, GEMINI_API_KEY, is read from <video>/.gemini.env or the
environment, and is never printed or written anywhere.

Outputs: snap2shelf-walkthrough-final.mp4, snap2shelf-walkthrough-final-captioned.mp4,
mix.wav, vo_only.wav, music_only.wav, sfx_only.wav, mix_waveform.png, CREDITS.txt, and a
"Voice-over (generated)" section in VO_CUE_SHEET.md. Intermediates and the TTS cache:
<video>/work/audio/.

Needs: Python 3.10+, numpy, scipy, matplotlib, google-genai, ffmpeg/ffprobe on PATH.
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import io
import json
import math
import os
import re
import subprocess
import sys
import time
import wave
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from scipy import signal
from scipy.ndimage import maximum_filter1d, minimum_filter1d, uniform_filter1d

try:  # Windows consoles default to cp1252
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
except Exception:
    pass

ROOT = Path(__file__).resolve().parents[2]
SR = 48000
PICTURE_NAME = "snap2shelf-walkthrough-picture.mp4"
CAPTIONED_NAME = "snap2shelf-walkthrough-captioned.mp4"
FINAL_NAME = "snap2shelf-walkthrough-final.mp4"
FINAL_CAPTIONED_NAME = "snap2shelf-walkthrough-final-captioned.mp4"
CUE_NAME = "VO_CUE_SHEET.md"

TTS_MODEL = "gemini-3.8-flash-tts"  # verified against ai.google.dev/gemini-api/docs/speech-generation and models.list, 30 Sep 2026
TEXT_MODELS = ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-2.5-flash"]  # listen to the voice stem (the next one when a model is overloaded)
AUDITION_VOICES = ["Sulafat", "Achird", "Charon", "Iapetus"]  # Warm, Friendly, Informative, Clear
VOICE = "Achird"  # chosen by --audition: clarity 9/10 from the listener, the clearest 1-4 kHz articulation, ~2.7 w/s fits the windows
STYLE = "warm, clear and upbeat, a confident product-demo narrator, at a relaxed medium pace"
STYLE_BRISK = "warm, clear and upbeat, a confident product-demo narrator, at a slightly brisk, energetic pace"
STYLE_OUTRO = "warm, friendly and inviting, unhurried, reading the web address clearly"
MIN_REQUEST_GAP_S = 15.0  # pacing: the free tier allows ~4 TTS requests a minute per key
MAX_TEMPO = 1.12
BREATH_S = 0.3  # silence kept before the next line starts
VO_CLIP_LUFS = -20.0

# Final loudness
TARGET_LUFS = -14.0
TARGET_TP = -1.0
BED_LUFS = -26.0  # the bed on its own, in the final mix
DUCK_DB = 6.0  # under the voice: the bed lands near -32 LUFS

# Honest narration: the cue sheet is written for a person reading it aloud; a neutral AI narrator is not that person.
REWRITES: list[tuple[str, str, str]] = [
    (r"^I'm <YOUR_NAME>\.\s*This is Snap2Shelf, for ", "This is Snap2Shelf, built for ", "neutral narrator: no named person; 'built for' keeps the track name"),
    (r"I built it with Claude Code, using Cloudinary's Skills Pack\.", "It's built with Claude Code, using Cloudinary's Skills Pack.", "the narrator is an AI voice, not the builder"),
    (r"two and a half thousand rupees", "two thousand five hundred rupees", "₹2,500 read in full (same figure)"),
]
# Spellings for the TTS only (what the listener hears is the same words)
SPOKEN: list[tuple[str, str]] = [
    (r"snap2shelf\.vercel\.app", "snap-two-shelf dot vercel dot app"),
    (r"Snap2Shelf", "Snap-to-Shelf"),
    (r"\bZIP\b", "zip"),
    (r"\bREADME\b", "read-me"),
]


def log(msg: str) -> None:
    print(f"[audio] {msg}", flush=True)


# ─── Paths, cue sheet ─────────────────────────────────────────────────────────


def default_out() -> Path:
    """The `video` folder next to the repo (for a worktree, the one beside the worktrees folder); never inside the repo."""
    for anc in ROOT.parents:
        cand = anc / "video"
        if cand.is_dir() and cand.resolve() != ROOT and ROOT not in cand.resolve().parents and not (cand / ".git").exists():
            return cand
    return ROOT.parent / "snap2shelf-video"


def parse_tc(s: str) -> float:
    m = re.fullmatch(r"\s*(\d+):(\d+(?:\.\d+)?)\s*", s)
    if not m:
        raise ValueError(f"bad timecode {s!r}")
    return int(m.group(1)) * 60 + float(m.group(2))


def tc(t: float) -> str:
    return f"{int(t // 60)}:{t % 60:04.1f}"


@dataclass
class Line:
    i: int
    t: float  # cue start
    seg: str
    cue_text: str  # as the cue sheet has it
    text: str = ""  # narration (after the honest rewrites)
    spoken: str = ""  # what the TTS is given
    changes: list[str] = field(default_factory=list)
    next_t: float = 0.0
    style: str = STYLE
    clip: np.ndarray | None = None
    tempo: float = 1.0
    start: float = 0.0
    end: float = 0.0
    raw_dur: float = 0.0


@dataclass
class Segment:
    name: str
    start: float
    end: float


def parse_cue_sheet(path: Path) -> tuple[list[Line], list[Segment]]:
    lines: list[Line] = []
    segs: list[Segment] = []
    mode = None
    for row in path.read_text(encoding="utf-8").splitlines():
        if row.startswith("| Timecode | Segment |"):
            mode = "vo"
            continue
        if row.startswith("| Starts | Ends | Segment |"):
            mode = "seg"
            continue
        if row.startswith("## "):
            mode = None
        if not row.startswith("|") or row.startswith("|---"):
            if not row.strip():
                continue
            if not row.startswith("|"):
                mode = None if row.startswith("#") else mode
            continue
        cells = [c.strip() for c in row.strip().strip("|").split("|")]
        if mode == "vo" and len(cells) >= 4:
            lines.append(Line(len(lines) + 1, parse_tc(cells[0]), cells[1], cells[3]))
        elif mode == "seg" and len(cells) >= 3:
            segs.append(Segment(cells[2], parse_tc(cells[0]), parse_tc(cells[1])))
    if not lines or not segs:
        raise SystemExit(f"{path.name}: no voice-over table or no Segments table found")
    return lines, segs


def narrate(lines: list[Line], total: float) -> None:
    for k, ln in enumerate(lines):
        text = ln.cue_text
        for pat, rep, why in REWRITES:
            new = re.sub(pat, rep, text)
            if new != text:
                ln.changes.append(why)
                text = new
        if "<YOUR_NAME>" in text or re.search(r"\b(I'm|I am|my)\b|\bI\b(?! ?/)", text):
            raise SystemExit(f"line {ln.i} still speaks as a person: {text!r} (add a rewrite to REWRITES)")
        ln.text = text
        spoken = text
        for pat, rep in SPOKEN:
            spoken = re.sub(pat, rep, spoken)
        ln.spoken = spoken
        ln.next_t = lines[k + 1].t if k + 1 < len(lines) else total
        ln.style = STYLE_OUTRO if ln.seg == "outro" else STYLE


# ─── Gemini (one key, paced, cached) ─────────────────────────────────────────


class Unavailable(Exception):
    pass


class Missing(SystemExit):
    pass


class HttpError(Exception):
    def __init__(self, code: int, body: str):
        super().__init__(f"{code} {body[:600]}")
        self.code = code


class Gemini:
    def __init__(self, video: Path, cache: Path, offline: bool, tts_model: str = ""):
        self.tts_model = tts_model or TTS_MODEL
        self.cache = cache
        self.cache.mkdir(parents=True, exist_ok=True)
        self.offline = offline
        self.keys = self._load_keys(video / ".gemini.env")
        self._client = None
        self.last = 0.0
        self.requests: list[dict] = []
        self.log_path = cache / "requests.jsonl"

    @staticmethod
    def _load_keys(env_path: Path) -> list[str]:
        env: dict[str, str] = {}
        if env_path.exists():
            for row in env_path.read_text(encoding="utf-8").splitlines():
                row = row.strip()
                if row and not row.startswith("#") and "=" in row:
                    k, v = row.split("=", 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
        key = os.environ.get("GEMINI_API_KEY") or env.get("GEMINI_API_KEY", "")
        return [key] if key else []  # one key only: its own rate limits are respected, never spread across others

    def redact(self, s: str) -> str:
        for k in self.keys:
            s = s.replace(k, "***")
        return s

    @property
    def client(self):
        if not self.keys:
            raise SystemExit("no GEMINI_API_KEY (in <video>/.gemini.env or the environment)")
        if self._client is None:
            if not self.keys:
                raise SystemExit("no GEMINI_API_KEY (in <video>/.gemini.env or the environment)")
            from google import genai

            self._client = genai.Client(api_key=self.keys[0])
        return self._client

    def _call(self, what: str, fn, attempts: int = 8):
        """One logical request on the one key: paced; 429/5xx retried with backoff; an invalid key stops the run."""
        if self.offline:
            raise Missing(f"--offline: {what} is not in the cache")
        delay = 20.0
        for attempt in range(attempts):
            wait = self.last + MIN_REQUEST_GAP_S - time.time()
            if wait > 0:
                time.sleep(wait)
            self.last = time.time()
            rec = {"at": time.strftime("%H:%M:%S"), "what": what, "attempt": attempt + 1}
            try:
                out = fn(self.client)
                rec["status"] = "ok"
                self.requests.append(rec)
                self._log(rec)
                return out
            except Exception as e:  # google.genai.errors.APIError and transport errors
                code = getattr(e, "code", None)
                msg = self.redact(str(e))
                rec["status"] = f"error {code}"
                quota = sorted(set(re.findall(r"quota_?(?:metric|id)['\"]?\s*[:=]\s*['\"]?([\w./-]+)|limit:\s*(\d+)", msg)))
                rec["detail"] = (" ".join(a or b for a, b in quota) or msg[:200]) if code == 429 else msg[:200]
                self.requests.append(rec)
                self._log(rec)
                if code in (400, 401, 403) and re.search(r"API[_ ]KEY[_ ]INVALID|API key not valid|API key expired|unregistered callers", msg, re.I):
                    raise SystemExit("GEMINI_API_KEY was rejected as invalid; set a valid key in <video>/.gemini.env")
                if code == 429:
                    if re.search(r"PerDay|per day|daily", msg, re.I):
                        raise SystemExit(f"Gemini daily quota exhausted for this key ({what}); re-run tomorrow — the cache keeps every clip made so far")
                    m = re.search(r"retry(?:Delay)?['\"]?\s*[:=]?\s*['\"]?(\d+(?:\.\d+)?)s", msg, re.I) or re.search(r"retry in (\d+(?:\.\d+)?)", msg, re.I)
                    sleep = max(float(m.group(1)) + 2 if m else delay, 5)
                    log(f"  429 rate-limited on {what}; waiting {sleep:.0f} s (attempt {attempt + 1})")
                    time.sleep(sleep)
                    delay = min(delay * 2, 180)
                    continue
                if code in (500, 502, 503, 504) or code is None:
                    if attempt + 1 >= attempts:
                        raise Unavailable(what)
                    log(f"  {code or 'transport'} error on {what}: {msg[:160]}; retrying in {delay:.0f} s")
                    time.sleep(delay)
                    delay = min(delay * 2, 180)
                    continue
                raise SystemExit(f"Gemini error on {what}: {code} {msg[:400]}")
        raise SystemExit(f"Gemini: gave up on {what} after {attempts} attempts")

    def _log(self, rec: dict) -> None:
        with self.log_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec) + "\n")

    def cached(self, text: str, voice: str, style: str) -> Path | None:
        key = hashlib.sha1(f"{self.tts_model}|{voice}|ann:{style}|{text}".encode()).hexdigest()[:16]
        path = self.cache / f"tts_{voice}_{key}.wav"
        return path if path.exists() else None

    def tts(self, text: str, voice: str, style: str) -> Path:
        # The Interactions API (REST; google-genai 1.45 has no client for it) with the style as a speech_metadata
        # annotation, as the speech-generation docs show. Through generateContent, gemini-3.8-flash-tts reads a
        # "Say ...:" prefix aloud and refuses a system instruction.
        key = hashlib.sha1(f"{self.tts_model}|{voice}|ann:{style}|{text}".encode()).hexdigest()[:16]
        path = self.cache / f"tts_{voice}_{key}.wav"
        if path.exists():
            return path
        body = {
            "model": self.tts_model,
            "input": [{"type": "user_input", "content": [{"type": "text", "text": text, "annotations": [{"type": "speech_metadata", "style": style}]}]}],
            "response_format": {"type": "audio"},
            "generation_config": {"speech_config": [{"voice": voice}]},
        }

        def go(_client):
            import base64
            import urllib.error
            import urllib.request

            req = urllib.request.Request(
                "https://generativelanguage.googleapis.com/v1beta/interactions",
                data=json.dumps(body).encode(),
                headers={"x-goog-api-key": self.keys[0], "Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=180) as r:
                    res = json.loads(r.read())
            except urllib.error.HTTPError as e:
                raise HttpError(e.code, e.read().decode("utf-8", "replace")) from None
            audio = [c for st in res.get("steps", []) if st.get("type") == "model_output" for c in st.get("content", []) if c.get("type") == "audio"]
            if not audio:
                raise RuntimeError("no audio in the response")
            return base64.b64decode(audio[-1]["data"]), audio[-1].get("mime_type", "audio/wav")

        data, mime = self._call(f"tts {voice} '{text[:40]}'", go)
        if isinstance(data, str):
            import base64

            data = base64.b64decode(data)
        if data[:4] == b"RIFF":
            path.write_bytes(data)
        else:  # raw 16-bit little-endian mono PCM, rate in the mime type (audio/L16;codec=pcm;rate=24000)
            m = re.search(r"rate=(\d+)", mime)
            rate = int(m.group(1)) if m else 24000
            with wave.open(str(path), "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(rate)
                w.writeframes(data)
        (self.cache / f"tts_{voice}_{key}.json").write_text(json.dumps({"model": self.tts_model, "voice": voice, "style": style, "text": text, "mime": mime}, ensure_ascii=False, indent=1), encoding="utf-8")
        return path

    def listen(self, name: str, wav_bytes: bytes, prompt: str, json_out: bool = False) -> str:
        key = hashlib.sha1(wav_bytes + prompt.encode()).hexdigest()[:16]
        path = self.cache / f"listen_{name}_{key}.txt"
        if path.exists():
            return path.read_text(encoding="utf-8")
        from google.genai import types

        cfg = types.GenerateContentConfig(temperature=0, response_mime_type="application/json" if json_out else None)
        out = None
        for model in TEXT_MODELS:

            def go(client, model=model):
                r = client.models.generate_content(model=model, contents=[types.Part.from_bytes(data=wav_bytes, mime_type="audio/wav"), prompt], config=cfg)
                return r.text or ""

            try:
                out = self._call(f"listen {name} ({model})", go, attempts=2)
                break
            except Unavailable:
                log(f"  {model} is overloaded; trying the next model")
        if out is None:
            raise SystemExit("every listener model is overloaded; re-run with --no-transcribe or later")
        path.write_text(out, encoding="utf-8")
        return out


# ─── Audio helpers ───────────────────────────────────────────────────────────


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    """Any WAV -> float32 (n,) or (n, ch) and its rate, via ffmpeg's decoder (handles float, 16/24-bit)."""
    info = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate,channels", "-of", "json", str(path)], capture_output=True, text=True, check=True)
    st = json.loads(info.stdout)["streams"][0]
    rate, ch = int(st["sample_rate"]), int(st["channels"])
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-acodec", "pcm_f32le", "-"], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.float32).copy()
    return (x.reshape(-1, ch) if ch > 1 else x), rate


def write_wav(path: Path, x: np.ndarray, rate: int = SR, codec: str = "pcm_s24le") -> None:
    x = np.asarray(x, np.float32)
    ch = 1 if x.ndim == 1 else x.shape[1]
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(rate), "-ac", str(ch), "-i", "-", "-c:a", codec, str(path)],
        input=np.ascontiguousarray(x).tobytes(),
        check=True,
    )


def ffmpeg_filter(x: np.ndarray, rate_in: int, af: str, rate_out: int = SR) -> np.ndarray:
    ch = 1 if x.ndim == 1 else x.shape[1]
    r = subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(rate_in), "-ac", str(ch), "-i", "-", "-af", af, "-ar", str(rate_out), "-f", "f32le", "-acodec", "pcm_f32le", "-"],
        input=np.ascontiguousarray(x, np.float32).tobytes(),
        capture_output=True,
        check=True,
    )
    y = np.frombuffer(r.stdout, np.float32).copy()
    return y.reshape(-1, ch) if ch > 1 else y


_KW = None


def lufs(x: np.ndarray, rate: int = SR, mask: np.ndarray | None = None) -> float:
    """ITU-R BS.1770-4 integrated loudness (gated). `mask` (per sample, bool) keeps only the 400 ms blocks it covers."""
    global _KW
    if x.ndim == 1:
        x = x[:, None]
    if _KW is None or _KW[0] != rate:
        # K-weighting: the spec's 48 kHz biquads, re-derived for other rates
        f0, g, q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
        k = math.tan(math.pi * f0 / rate)
        vh = 10 ** (g / 20)
        vb = vh**0.4996667741545416
        a0 = 1 + k / q + k * k
        b1 = [(vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0]
        a1 = [1, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0]
        f0, q = 38.13547087602444, 0.5003270373238773
        k = math.tan(math.pi * f0 / rate)
        a0 = 1 + k / q + k * k
        b2 = [1, -2, 1]
        a2 = [1, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0]
        _KW = (rate, b1, a1, b2, a2)
    _, b1, a1, b2, a2 = _KW
    y = signal.lfilter(b2, a2, signal.lfilter(b1, a1, x.astype(np.float64), axis=0), axis=0)
    blk, hop = int(0.4 * rate), int(0.1 * rate)
    if len(y) < blk:
        return -120.0
    p = (y**2).sum(axis=1)
    c = np.concatenate([[0.0], np.cumsum(p)])
    starts = np.arange(0, len(y) - blk + 1, hop)
    z = (c[starts + blk] - c[starts]) / blk
    if mask is not None:
        cm = np.concatenate([[0], np.cumsum(mask.astype(np.int64))])
        z = z[(cm[starts + blk] - cm[starts]) > 0.5 * blk]
    z = z[z > 0]
    if not len(z):
        return -120.0
    lk = -0.691 + 10 * np.log10(z)
    z = z[lk > -70]
    if not len(z):
        return -120.0
    rel = -0.691 + 10 * np.log10(z.mean()) - 10
    z = z[-0.691 + 10 * np.log10(z) > rel]
    return float(-0.691 + 10 * np.log10(z.mean()))


def db(x: float) -> float:
    return 10 ** (x / 20)


def trim_silence(x: np.ndarray, rate: int, head: float = 0.035, tail: float = 0.09) -> np.ndarray:
    frame = int(0.01 * rate)
    n = len(x) // frame
    if n < 3:
        return x
    rms = np.sqrt((x[: n * frame].reshape(n, frame) ** 2).mean(axis=1) + 1e-12)
    rdb = 20 * np.log10(rms)
    thr = max(-55.0, rdb.max() - 42)
    on = np.where(rdb > thr)[0]
    a = max(0, on[0] * frame - int(head * rate))
    b = min(len(x), (on[-1] + 1) * frame + int(tail * rate))
    y = x[a:b].copy()
    fi, fo = int(0.008 * rate), int(0.04 * rate)
    y[:fi] *= np.linspace(0, 1, fi)
    y[-fo:] *= np.linspace(1, 0, fo) ** 2
    return y


VO_CHAIN = "highpass=f=80:poles=2,deesser=i=0.35:m=0.5:f=0.5:s=o,acompressor=threshold=-20dB:ratio=2.5:attack=6:release=90:knee=4:makeup=2"


def process_clip(src: Path | tuple[np.ndarray, int], tempo: float = 1.0) -> np.ndarray:
    """A TTS take (a WAV path, or (samples, rate)) -> trimmed, 48 kHz, high-passed, de-essed, compressed, loudness-matched."""
    x, rate = read_wav(src) if isinstance(src, Path) else src
    if x.ndim > 1:
        x = x.mean(axis=1)
    x = trim_silence(x, rate)
    af = "aresample=48000:resampler=soxr:precision=28," + VO_CHAIN + (f",atempo={tempo:.4f}" if abs(tempo - 1) > 1e-4 else "")
    y = ffmpeg_filter(x, rate, af)
    y = trim_silence(y, SR, head=0.02, tail=0.08)  # atempo/compressor tails
    return (y * db(VO_CLIP_LUFS - lufs(y))).astype(np.float32)


def split_batch(x: np.ndarray, rate: int, words: list[int]) -> list[np.ndarray]:
    """Cut a batched take (lines read one after another, a long pause between) at its len(words)-1 longest pauses.
    Checks each piece's length against its word count, so a mis-cut fails loudly instead of shifting the script."""
    frame = int(0.01 * rate)
    n = len(x) // frame
    rms = 20 * np.log10(np.sqrt((x[: n * frame].reshape(n, frame) ** 2).mean(axis=1) + 1e-12))
    on = rms > rms.max() - 40
    idx = np.where(on)[0]
    a0, a1 = int(idx[0]), int(idx[-1])
    gaps: list[tuple[int, int, int]] = []  # (length, start, end) of the silent runs inside the speech
    i = a0
    while i <= a1:
        if not on[i]:
            j = i
            while j <= a1 and not on[j]:
                j += 1
            gaps.append((j - i, i, j))
            i = j
        else:
            i += 1
    k = len(words) - 1
    ranked = sorted(gaps, reverse=True)
    if len(ranked) < k:
        raise SystemExit(f"batch: found {len(ranked)} pauses for {len(words)} lines")
    cuts = sorted(ranked[:k], key=lambda g: g[1])
    bounds = [a0] + [c for g in cuts for c in (g[1], g[2])] + [a1 + 1]
    pieces = [x[max(0, bounds[2 * m] * frame - int(0.05 * rate)) : min(len(x), bounds[2 * m + 1] * frame + int(0.12 * rate))] for m in range(len(words))]
    durs = np.array([len(q) / rate for q in pieces])
    wps = np.array(words) / durs
    kept = ranked[k][0] / 100 if len(ranked) > k else 0.0
    log(f"  batch split: {', '.join(f'{d:.1f} s' for d in durs)} (cut at pauses {', '.join(f'{g[0] / 100:.2f}' for g in cuts)} s; longest pause kept inside a line {kept:.2f} s)")
    if (wps.max() > 1.9 * wps.min() and min(words) >= 6) or wps.max() > 4.2:
        raise BadSplit(f"batch split looks wrong (words/s per piece {np.round(wps, 2).tolist()})")
    return pieces


class BadSplit(Exception):
    pass


def batch_takes(grp: list[Line], gem: Gemini, voice: str, depth: int = 0) -> list[tuple[np.ndarray, int]]:
    """One request for the group, cut into its lines; a take that doesn't cut cleanly (a skipped or rushed line)
    is asked for again as two smaller groups."""
    text = "\n\n<long pause>\n\n".join(ln.spoken for ln in grp)
    x, rate = read_wav(gem.tts(text, voice, STYLE))
    x = x if x.ndim == 1 else x.mean(axis=1)
    if len(grp) == 1:
        return [(x, rate)]
    try:
        return [(q, rate) for q in split_batch(x, rate, [len(ln.spoken.split()) for ln in grp])]
    except BadSplit as e:
        if depth >= 2:
            raise SystemExit(str(e))
        log(f"  lines {grp[0].i}-{grp[-1].i}: {e}; asking again in two halves")
        h = (len(grp) + 1) // 2
        return batch_takes(grp[:h], gem, voice, depth + 1) + batch_takes(grp[h:], gem, voice, depth + 1)


def batch_groups(lines: list[Line], max_lines: int = 2, max_words: int = 80) -> list[list[Line]]:  # longer batches dropped words
    groups: list[list[Line]] = []
    for ln in lines:
        w = len(ln.spoken.split())
        if groups and len(groups[-1]) < max_lines and sum(len(x.spoken.split()) for x in groups[-1]) + w <= max_words:
            groups[-1].append(ln)
        else:
            groups.append([ln])
    return groups


def speech_mask(vo: np.ndarray, hold: float = 0.45) -> np.ndarray:
    """True where the voice is speaking, gaps shorter than `hold` bridged (per sample)."""
    frame = int(0.01 * SR)
    n = len(vo) // frame
    rms = np.sqrt((vo[: n * frame].reshape(n, frame) ** 2).mean(axis=1) + 1e-12)
    on = 20 * np.log10(rms) > (20 * np.log10(rms.max()) - 38)
    on = maximum_filter1d(on.astype(np.uint8), size=int(hold / 0.01)).astype(bool)
    on = minimum_filter1d(on.astype(np.uint8), size=max(1, int(hold / 0.01) - 10)).astype(bool)
    m = np.repeat(on, frame)
    return np.concatenate([m, np.zeros(len(vo) - len(m), bool)])


def smooth_gate(mask: np.ndarray, attack: float, release: float, lookahead: float) -> np.ndarray:
    """0..1 envelope from a boolean mask: rises over `attack`, falls over `release`, starts `lookahead` early (cosine ramps)."""
    step = int(0.005 * SR)
    m = mask[::step].astype(np.float64)
    la = int(lookahead / 0.005)
    if la:
        m = np.concatenate([m[la:], np.zeros(la)])
    ca, cr = math.exp(-0.005 / (attack / 3)), math.exp(-0.005 / (release / 3))  # ~95 % of the way in attack / release
    env = np.empty_like(m)
    e = 0.0
    for i, x in enumerate(m):
        e = x + (e - x) * (ca if x > e else cr)
        env[i] = e
    out = np.interp(np.arange(len(mask)) / step, np.arange(len(env)), env)
    return out.astype(np.float32)


def true_peak_limit(x: np.ndarray, ceiling_db: float) -> tuple[np.ndarray, float]:
    """Look-ahead limiter on the 4x-oversampled peak (so true peak <= ceiling). Returns (y, max gain reduction dB)."""
    up = signal.resample_poly(x, 4, 1, axis=0)
    pk = np.abs(up).max(axis=1)
    pk = pk[: (len(pk) // 4) * 4].reshape(-1, 4).max(axis=1)
    pk = np.concatenate([pk, np.zeros(len(x) - len(pk))])
    need = np.minimum(1.0, db(ceiling_db) / np.maximum(pk, 1e-9))
    la = int(0.004 * SR)
    g = minimum_filter1d(need, size=4 * la + 1)
    g = uniform_filter1d(g, size=2 * la + 1)
    g = minimum_filter1d(g, size=1)  # keep dtype/shape
    return (x * g[:, None]).astype(np.float32), float(-20 * np.log10(g.min()))


def peaking_eq(x: np.ndarray, f0: float, gain_db: float, q: float) -> np.ndarray:
    """RBJ-cookbook peaking biquad."""
    a = 10 ** (gain_db / 40)
    w = 2 * math.pi * f0 / SR
    al = math.sin(w) / (2 * q)
    b = [1 + al * a, -2 * math.cos(w), 1 - al * a]
    den = [1 + al / a, -2 * math.cos(w), 1 - al / a]
    return signal.lfilter(np.array(b) / den[0], np.array(den) / den[0], x, axis=0).astype(np.float32)


def pan_gains(p: float) -> tuple[float, float]:
    """Equal-power pan, p in -1..1."""
    a = (p + 1) * math.pi / 4
    return math.cos(a), math.sin(a)


def midi_hz(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


# ─── Music bed (original, synthesised) ────────────────────────────────────────

BPM = 100.0
BEAT = 60.0 / BPM
BAR = 4 * BEAT
CHORD_S = 2 * BAR  # one chord every two bars

# (bass midi, pad voicing) — D major, smooth voice leading
CH = {
    "Dmaj9": (38, [50, 57, 61, 64, 66]),
    "Bm9": (35, [54, 57, 61, 62, 66]),
    "Gmaj9": (31, [50, 54, 57, 59, 62]),
    "A9sus": (33, [52, 55, 59, 62, 64]),
    "F#m7": (30, [54, 57, 61, 64, 69]),
    "Em9": (28, [50, 54, 55, 59, 62]),
}
PROG_A = ["Dmaj9", "Bm9", "Gmaj9", "A9sus"]
PROG_B = ["Gmaj9", "A9sus", "F#m7", "Bm9"]  # the calmer stretch (the URL, the cost)
ENERGY = {"title": 0, "hook": 1, "studio": 2, "reel": 2, "qa": 2, "dna": 2, "stages": 2, "live": 3, "kit": 2, "shelf": 2, "xray": 1.5, "cost": 1.5, "arch": 2.2, "outro": 3}
BRIGHT = {0: 0.30, 1: 0.32, 1.5: 0.42, 2: 0.55, 2.2: 0.62, 3: 0.88}


class Music:
    def __init__(self, total: float, segs: list[Segment], seed: int = 7):
        self.total = total
        self.n = int(math.ceil(total * SR))
        self.segs = segs
        self.rng = np.random.default_rng(seed)
        self.t = np.arange(self.n, dtype=np.float64) / SR
        # the outro resolves: a dominant chord, then the tonic held to the end
        outro = next((s for s in segs if s.name == "outro"), None)
        self.final_k = int(math.ceil((outro.start + 2.0) / CHORD_S)) if outro else int(total // CHORD_S)
        self.end_hits = self.final_k * CHORD_S + BAR  # drums stop one bar into the final chord

    def seg_at(self, t: float) -> str:
        cur = self.segs[0].name
        for s in self.segs:
            if t >= s.start + 0.25:  # the dissolve's midpoint
                cur = s.name
        return cur

    def energy(self, t: float) -> float:
        return ENERGY.get(self.seg_at(t), 2)

    def chord(self, k: int) -> str:
        if k == self.final_k - 1:
            return "A9sus"
        if k >= self.final_k:
            return "Dmaj9"
        seg = self.seg_at(k * CHORD_S + CHORD_S / 2)
        prog = PROG_B if seg in ("xray", "cost") else PROG_A
        return prog[k % 4]

    def curve(self, table: dict[str, float] | None, fn=None, ramp: float = 1.6) -> np.ndarray:
        """A per-sample automation curve from a per-segment value, ramped smoothly across each dissolve."""
        pts_t, pts_v = [0.0], []
        vals = []
        for s in self.segs:
            v = fn(s.name) if fn else table.get(s.name, 0.0)  # type: ignore[union-attr]
            vals.append((s.start + 0.25, v))
        pts_t, pts_v = [], []
        for i, (t0, v) in enumerate(vals):
            if i == 0:
                pts_t.append(0.0)
                pts_v.append(v)
                continue
            pts_t += [t0 - ramp / 2, t0 + ramp / 2]
            pts_v += [pts_v[-1], v]
        pts_t.append(self.total + 1)
        pts_v.append(pts_v[-1])
        return np.interp(self.t, pts_t, pts_v).astype(np.float32)

    # ── instruments ──

    @staticmethod
    def saw(freq: np.ndarray | float, n: int, phase0: float) -> np.ndarray:
        """Band-limited (PolyBLEP) sawtooth; `freq` may be per-sample."""
        dt = np.broadcast_to(np.asarray(freq, np.float64) / SR, (n,))
        ph = (phase0 + np.cumsum(dt)) % 1.0
        y = 2 * ph - 1
        m = ph < dt
        tt = ph[m] / dt[m]
        y[m] -= tt + tt - tt * tt - 1
        m = ph > 1 - dt
        tt = (ph[m] - 1) / dt[m]
        y[m] -= tt * tt + tt + tt + 1
        return y

    def pads(self) -> np.ndarray:
        out = np.zeros((self.n, 2), np.float32)
        att, rel = 1.3, 2.2
        nk = int(math.ceil(self.total / CHORD_S)) + 1
        for k in range(nk):
            t0 = k * CHORD_S
            if t0 >= self.total:
                break
            name = self.chord(k)
            final = k >= self.final_k
            dur = (self.total - t0 + 0.5) if final else CHORD_S
            n = min(int((dur + rel) * SR), self.n - int(t0 * SR))
            if n <= 0:
                continue
            tt = np.arange(n) / SR
            env = np.minimum(1, tt / att) ** 1.5
            env *= np.where(tt > dur, np.clip(1 - (tt - dur) / rel, 0, 1) ** 2, 1.0)
            vib = 1 + 0.0012 * np.sin(2 * np.pi * 0.23 * tt + k)
            for j, m in enumerate(CH[name][1]):
                f = midi_hz(m)
                for d_cents, p in ((-9, -0.65), (0, 0.0), (9, 0.65)):
                    y = self.saw(f * 2 ** (d_cents / 1200) * vib, n, self.rng.random()) * env * (0.55 if d_cents else 0.45)
                    y += 0.35 * np.sin(2 * np.pi * f * tt + self.rng.random() * 6.28) * env  # sine body
                    gl, gr = pan_gains(p * (0.8 if j % 2 else 1.0))
                    a = int(t0 * SR)
                    out[a : a + n, 0] += (y * gl).astype(np.float32)
                    out[a : a + n, 1] += (y * gr).astype(np.float32)
        # brightness: crossfade a dark and an open low-pass by the segment's energy
        dark = signal.sosfilt(signal.butter(4, 750, "low", fs=SR, output="sos"), out, axis=0)
        bright = signal.sosfilt(signal.butter(4, 3600, "low", fs=SR, output="sos"), out, axis=0)
        b = self.curve(None, lambda s: BRIGHT.get(ENERGY.get(s, 2), 0.55), ramp=3.0)[:, None]
        y = dark * (1 - b) + bright * b
        y = signal.sosfilt(signal.butter(2, 90, "high", fs=SR, output="sos"), y, axis=0)
        gain = self.curve(None, lambda s: {0: 1.0, 1: 0.9, 1.5: 0.85}.get(ENERGY.get(s, 2), 0.8), ramp=3.0)[:, None]
        return (y * gain).astype(np.float32)

    def pluck_note(self, f: float, dur: float, vel: float) -> np.ndarray:
        n = int(dur * SR)
        t = np.arange(n) / SR
        idx = 1.1 * np.exp(-t / 0.08)
        y = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * 2 * f * t))
        y = y * (1 - np.exp(-t / 0.003)) * np.exp(-t / 0.42) + 0.3 * np.sin(2 * np.pi * f * t) * np.exp(-t / 0.9) * (1 - np.exp(-t / 0.004))
        return (y * vel).astype(np.float32)

    def plucks(self) -> np.ndarray:
        out = np.zeros((self.n, 2), np.float32)
        step = BEAT / 2
        patterns = [
            [1, 0, 1, 1, 0, 1, 0, 1],
            [1, 0, 1, 0, 1, 1, 0, 1],
        ]
        order = [0, 2, 3, 4, 3, 2, 1, 2]  # up-down through the voicing
        nsteps = int(self.total / step) + 1
        for s in range(nsteps):
            t0 = s * step
            if t0 >= self.total - 0.3:
                break
            e = self.energy(t0)
            k = int(t0 // CHORD_S)
            name = self.chord(k)
            bar = int(t0 // BAR)
            pos = s % 8
            final = k >= self.final_k
            if final:  # the last chord: one slow rising arpeggio, then let it ring
                rel = t0 - self.final_k * CHORD_S
                if rel > 2.0 * BAR or pos % 2:
                    continue
            elif e < 1:
                if pos not in (0, 4) or bar % 2:  # title: a few sparse notes
                    continue
            elif e < 2:
                if pos % 2:  # quarter notes
                    continue
            elif not patterns[bar % 2][pos]:
                continue
            voicing = CH[name][1]
            m = voicing[order[(s // 1) % len(order)] % len(voicing)] + 12
            if final:
                m = voicing[min(len(voicing) - 1, (s // 2) % len(voicing))] + 12 + (12 if ((s // 2) // len(voicing)) % 2 else 0)
            vel = (0.9 if pos in (0, 4) else 0.7) * (0.85 + 0.3 * self.rng.random())
            swing = 0.035 if pos % 2 else 0.0
            a = int((t0 + swing) * SR)
            note = self.pluck_note(midi_hz(m), 1.6, vel)
            n = min(len(note), self.n - a)
            gl, gr = pan_gains(0.35 if (s % 2) else -0.35)
            out[a : a + n, 0] += note[:n] * gl
            out[a : a + n, 1] += note[:n] * gr
            if e >= 3 and not final:  # the lift: the same line an octave up, quieter, wider
                note = self.pluck_note(midi_hz(m + 12), 1.2, vel * 0.42)
                n = min(len(note), self.n - a)
                gl, gr = pan_gains(-0.6 if (s % 2) else 0.6)
                out[a : a + n, 0] += note[:n] * gl
                out[a : a + n, 1] += note[:n] * gr
        out = signal.sosfilt(signal.butter(2, 5200, "low", fs=SR, output="sos"), out, axis=0).astype(np.float32)
        # ping-pong delay, dotted eighth
        d = int(0.75 * BEAT * SR)
        wet = np.zeros_like(out)
        mono = out.mean(axis=1)
        for i, g in enumerate((0.32, 0.2, 0.12, 0.07)):
            sh = d * (i + 1)
            ch = i % 2
            wet[sh:, 1 - ch] += mono[: self.n - sh] * g
        wet = signal.sosfilt(signal.butter(2, [400, 3000], "band", fs=SR, output="sos"), wet, axis=0)
        return (out + wet).astype(np.float32)

    def bass(self) -> np.ndarray:
        out = np.zeros(self.n, np.float32)
        for b in range(int(self.total / BAR) + 1):
            t0 = b * BAR
            if t0 >= self.total or (self.energy(t0 + 0.6) < 1.5 and b * BAR < self.final_k * CHORD_S):
                continue
            k = int(t0 // CHORD_S)
            root = CH[self.chord(k)][0]
            final = k >= self.final_k
            dur = (self.total - t0) if final else BAR - 0.08
            if final and t0 > self.final_k * CHORD_S:
                continue
            n = min(int((dur + 0.12) * SR), self.n - int(t0 * SR))
            tt = np.arange(n) / SR
            f = midi_hz(root + 12)
            env = (1 - np.exp(-tt / 0.012)) * (0.65 + 0.35 * np.exp(-tt / 0.35))
            env *= np.clip((dur + 0.12 - tt) / 0.12, 0, 1)
            if final:
                env *= np.exp(-tt / 2.5)
            y = np.tanh(1.6 * (np.sin(2 * np.pi * f * tt) + 0.25 * np.sin(4 * np.pi * f * tt))) * env
            a = int(t0 * SR)
            out[a : a + n] += y.astype(np.float32)
        out = signal.sosfilt(signal.butter(2, 900, "low", fs=SR, output="sos"), out)
        return np.stack([out, out], axis=1).astype(np.float32)

    def drums(self) -> tuple[np.ndarray, np.ndarray]:
        """(kick+rim+shaker stereo bus, the kick's envelope for a gentle pump on the pads)."""
        out = np.zeros((self.n, 2), np.float32)
        pump = np.zeros(self.n, np.float32)
        # one-shots
        tk = np.arange(int(0.45 * SR)) / SR
        kick = np.sin(2 * np.pi * np.cumsum(46 + 70 * np.exp(-tk / 0.035)) / SR) * np.exp(-tk / 0.22) * (1 - np.exp(-tk / 0.0015))
        kick += 0.15 * self.rng.standard_normal(len(tk)) * np.exp(-tk / 0.003)
        kick = signal.sosfilt(signal.butter(2, 4000, "low", fs=SR, output="sos"), kick).astype(np.float32)
        tr = np.arange(int(0.25 * SR)) / SR
        rim = signal.sosfilt(signal.butter(2, [1400, 4200], "band", fs=SR, output="sos"), self.rng.standard_normal(len(tr))) * np.exp(-tr / 0.045)
        rim = (rim * 1.4 + 0.5 * np.sin(2 * np.pi * 330 * tr) * np.exp(-tr / 0.03)).astype(np.float32)
        ts = np.arange(int(0.12 * SR)) / SR
        shak_sos = signal.butter(2, [5500, 12000], "band", fs=SR, output="sos")
        pump_env = np.exp(-np.arange(int(0.3 * SR)) / SR / 0.09).astype(np.float32)
        sixteenth = BEAT / 4
        for s in range(int(self.total / sixteenth) + 1):
            t0 = s * sixteenth
            if t0 >= min(self.total - 0.2, self.end_hits):
                break
            e = self.energy(t0 + 0.05)
            pos = s % 16
            if pos % 2:
                t0 += 0.022  # swing the off-sixteenths
            a = int(t0 * SR)
            if e >= 2 and pos in (0, 8, 10 if (s // 16) % 4 == 3 else 99):
                n = min(len(kick), self.n - a)
                out[a : a + n] += (kick[:n] * (1.0 if pos != 10 else 0.6))[:, None]
                m = min(len(pump_env), self.n - a)
                pump[a : a + m] = np.maximum(pump[a : a + m], pump_env[:m])
            if e >= 2 and pos in (4, 12):
                n = min(len(rim), self.n - a)
                gl, gr = pan_gains(-0.25)
                out[a : a + n, 0] += rim[:n] * 0.35 * gl
                out[a : a + n, 1] += rim[:n] * 0.35 * gr
            if e >= 1.5 and (pos % 2 == 0 or e >= 3):
                acc = 1.0 if pos % 4 == 2 else (0.55 if pos % 4 == 0 else 0.4)
                hit = signal.sosfilt(shak_sos, self.rng.standard_normal(len(ts))) * (1 - np.exp(-ts / 0.006)) * np.exp(-ts / 0.035)
                n = min(len(ts), self.n - a)
                gl, gr = pan_gains(0.3)
                v = acc * 0.22 * (0.8 + 0.4 * self.rng.random())
                out[a : a + n, 0] += (hit[:n] * v * gl).astype(np.float32)
                out[a : a + n, 1] += (hit[:n] * v * gr).astype(np.float32)
        return out, pump


def reverb_ir(seconds: float = 2.6, seed: int = 3) -> np.ndarray:
    """A synthetic stereo hall: decorrelated noise, three bands decaying at different rates, a pre-delay and a few early reflections."""
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = np.zeros((n, 2))
    for ch in range(2):
        noise = rng.standard_normal(n)
        lo = signal.sosfilt(signal.butter(2, 500, "low", fs=SR, output="sos"), noise) * np.exp(-6.9 * t / 2.4)
        mid = signal.sosfilt(signal.butter(2, [500, 3500], "band", fs=SR, output="sos"), noise) * np.exp(-6.9 * t / 1.9)
        hi = signal.sosfilt(signal.butter(2, 3500, "high", fs=SR, output="sos"), noise) * np.exp(-6.9 * t / 0.8)
        ir[:, ch] = lo + mid + hi * 0.6
        ir[:, ch] *= np.minimum(1, t / 0.03)  # soft onset
    pre = int(0.022 * SR)
    ir = np.concatenate([np.zeros((pre, 2)), ir])
    for d, g, ch in ((0.011, 0.5, 0), (0.017, 0.45, 1), (0.029, 0.35, 0), (0.037, 0.3, 1)):
        ir[int(d * SR), ch] += g * 8
    return (ir / np.sqrt((ir**2).sum(axis=0))).astype(np.float32)


def convolve_reverb(x: np.ndarray, ir: np.ndarray) -> np.ndarray:
    mono = x.mean(axis=1) if x.ndim > 1 else x
    side = (x[:, 0] - x[:, 1]) * 0.5 if x.ndim > 1 else 0 * mono
    out = np.zeros((len(mono), 2), np.float32)
    for ch in range(2):
        out[:, ch] = signal.oaconvolve(mono + (side if ch == 0 else -side) * 0.5, ir[:, ch])[: len(mono)]
    return out


def render_music(total: float, segs: list[Segment]) -> np.ndarray:
    m = Music(total, segs)
    log("music: pads")
    pads = m.pads()
    log("music: plucks, bass, drums")
    plucks = m.plucks()
    bass = m.bass()
    drums, pump = m.drums()
    pump_g = (1 - 0.14 * uniform_filter1d(pump, int(0.01 * SR)))[:, None]  # a gentle lo-fi pump from the kick
    pads *= pump_g
    bass *= pump_g
    # balance: each bus to a reference loudness, then its place in the bed
    rel = {"pads": 0.0, "plucks": -4.5, "bass": -6.0, "drums": -8.5}
    buses = {"pads": pads, "plucks": plucks, "bass": bass, "drums": drums}
    for k, x in buses.items():
        L = lufs(x)
        if L > -100:
            buses[k] = x * db(-20 + rel[k] - L)
    dry = sum(buses.values())
    log("music: reverb")
    ir = reverb_ir()
    send = buses["pads"] * 0.55 + buses["plucks"] * 0.6 + buses["drums"] * 0.18
    wet = convolve_reverb(send, ir)
    mix = dry + wet * db(-7)
    # glue: gentle high-pass, warm top, soft saturation, end fade
    mix = signal.sosfilt(signal.butter(2, 32, "high", fs=SR, output="sos"), mix, axis=0)
    mix = signal.sosfilt(signal.butter(1, 13000, "low", fs=SR, output="sos"), mix, axis=0)
    mix = peaking_eq(mix, 2500, -3.0, 0.8)  # leave the voice's presence band to the voice
    mix = peaking_eq(mix, 250, -1.5, 1.0)  # and a little less boxiness under it
    pk = np.abs(mix).max()
    mix = np.tanh(mix / pk * 1.2) * pk / 1.2
    t = np.arange(len(mix)) / SR
    fade_in = np.clip(t / 1.2, 0, 1) ** 2
    fade_out = np.clip((total - t) / 3.2, 0, 1) ** 1.5
    mix *= (fade_in * fade_out)[:, None]
    return mix.astype(np.float32)


# ─── Sound effects (synthesised) ──────────────────────────────────────────────


def sfx_whoosh(rng, dur: float = 1.15, peak: float = 0.62, lo: float = 350, hi: float = 3200) -> np.ndarray:
    n = int(dur * SR)
    out = np.zeros((n, 2), np.float32)
    nper = 1024
    for ch in range(2):
        noise = rng.standard_normal(n)
        f, tt, Z = signal.stft(noise, fs=SR, nperseg=nper, noverlap=nper * 3 // 4)
        frac = np.clip(tt / dur, 0, 1)
        pk = peak / dur
        fc = np.where(frac < pk, lo * (hi / lo) ** (frac / pk), hi * (0.35) ** ((frac - pk) / (1 - pk)))
        with np.errstate(divide="ignore"):
            mask = np.exp(-0.5 * (np.log2(np.maximum(f[:, None], 1) / fc[None, :]) / 0.75) ** 2)
        _, y = signal.istft(Z * mask, fs=SR, nperseg=nper, noverlap=nper * 3 // 4)
        out[:, ch] = y[:n]
    t = np.arange(n) / SR
    env = np.where(t < peak, (t / peak) ** 2.2, np.exp(-(t - peak) / 0.16))
    pan = np.clip(t / dur, 0, 1) * 1.4 - 0.7  # sweeps left -> right
    gl, gr = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    out[:, 0] *= env * gl
    out[:, 1] *= env * gr
    return out / np.abs(out).max()


def sfx_chime() -> np.ndarray:
    """Two soft bell notes, A5 then D6 (a resolved fourth in the bed's key)."""
    n = int(2.2 * SR)
    out = np.zeros((n, 2), np.float32)
    for k, (f, t0, pan) in enumerate(((880.0, 0.0, -0.25), (1174.66, 0.13, 0.25))):
        a = int(t0 * SR)
        t = np.arange(n - a) / SR
        y = np.zeros(len(t))
        for ratio, amp, tau in ((1.0, 1.0, 0.9), (2.0, 0.22, 0.45), (2.76, 0.1, 0.25), (5.4, 0.035, 0.08)):
            y += amp * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t / tau)
        y *= 1 - np.exp(-t / 0.002)
        gl, gr = pan_gains(pan)
        out[a:, 0] += (y * gl * (1.0 if k else 0.85)).astype(np.float32)
        out[a:, 1] += (y * gr * (1.0 if k else 0.85)).astype(np.float32)
    return out / np.abs(out).max()


def sfx_tick(rng) -> np.ndarray:
    n = int(0.05 * SR)
    t = np.arange(n) / SR
    f0 = 2600 * (0.85 + 0.3 * rng.random())
    noise = signal.sosfilt(signal.butter(2, [f0 * 0.6, f0 * 1.8], "band", fs=SR, output="sos"), rng.standard_normal(n))
    y = noise * np.exp(-t / 0.0035) + 0.35 * np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.009)
    y *= 1 - np.exp(-t / 0.0004)
    return (y / np.abs(y).max()).astype(np.float32)


def sfx_pop() -> np.ndarray:
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    f = 330 + 620 * np.exp(-t / 0.02)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.055) * (1 - np.exp(-t / 0.0012))
    y += 0.2 * np.sin(2 * np.pi * 1320 * t) * np.exp(-t / 0.018)
    y = signal.sosfilt(signal.butter(2, 3500, "low", fs=SR, output="sos"), y)
    return np.stack([y, y], axis=1).astype(np.float32) / np.abs(y).max()


@dataclass
class Cue:
    at: float
    kind: str
    note: str


def sfx_cues(segs: list[Segment]) -> list[Cue]:
    """Where each effect sits. Transitions come from the Segments table (the dissolve's midpoint); the in-picture
    moments were read off the footage (frame differences + stills) of this cut: see the notes."""
    cues: list[Cue] = []
    for a, b in zip(segs, segs[1:]):
        mid = (b.start + a.end) / 2
        cues.append(Cue(mid, "whoosh", f"{a.name} → {b.name} dissolve {tc(b.start)}–{tc(a.end)}"))
    by = {s.name: s for s in segs}
    if "studio" in by:
        st = by["studio"].start
        # studio replay (sample shmessy1): 'Approved' badge lands 15.3 s after the studio part starts; the cards
        # land from 20.7 s, 75 ms apart (kit-shelves.tsx deals with a 0.075 s stagger), ten cards (9 images + reel)
        cues.append(Cue(st + 15.30, "chime", "studio: QA 'Approved' badge appears (0:31.9)"))
        cues.append(Cue(st + 18.75, "fan", "studio: the hand fans open over the hero"))
        for i in range(10):
            cues.append(Cue(st + 20.70 + i * 0.075, "tick", f"studio: card {i + 1}/10 lands"))
    if "live" in by:
        lv = by["live"].start
        cues.append(Cue(lv + 19.95, "fan", "live: the hand fans open"))
        for i in range(8):  # 7 images + the reel
            cues.append(Cue(lv + 21.90 + i * 0.075, "tick", f"live: card {i + 1}/8 lands"))
    if "outro" in by:
        cues.append(Cue(by["outro"].start + 0.50, "pop", "outro: the QR code appears (2:59.5)"))
    return sorted(cues, key=lambda c: c.at)


def render_sfx(total: float, cues: list[Cue]) -> np.ndarray:
    rng = np.random.default_rng(11)
    n = int(math.ceil(total * SR))
    out = np.zeros((n, 2), np.float32)
    level = {"whoosh": -24.0, "chime": -21.0, "tick": -27.0, "fan": -30.0, "pop": -20.0}  # peak dBFS before the master gain
    ticks = 0
    for c in cues:
        if c.kind == "whoosh":
            x = sfx_whoosh(rng)
            a = int((c.at - 0.62) * SR)
        elif c.kind == "fan":
            x = sfx_whoosh(rng, dur=0.5, peak=0.2, lo=1200, hi=6000)
            a = int((c.at - 0.2) * SR)
        elif c.kind == "chime":
            x = sfx_chime()
            a = int(c.at * SR)
        elif c.kind == "tick":
            x = sfx_tick(rng)
            p = -0.6 + 1.2 * ((ticks % 10) / 9)
            gl, gr = pan_gains(p)
            x = np.stack([x * gl, x * gr], axis=1) * (0.8 + 0.25 * rng.random())
            ticks += 1
            a = int(c.at * SR)
        else:
            x = sfx_pop()
            a = int(c.at * SR)
        a = max(0, a)
        m = min(len(x), n - a)
        out[a : a + m] += x[:m] * db(level[c.kind])
    ir = reverb_ir(1.6, seed=5)
    return (out + convolve_reverb(out, ir) * db(-10)).astype(np.float32)


# ─── The voice track ─────────────────────────────────────────────────────────


def build_vo(lines: list[Line], gem: Gemini, voice: str, total: float, batch: bool, allow_missing: bool = False) -> np.ndarray:
    budget = lambda ln: ln.next_t - ln.t - (BREATH_S if ln.next_t < total else 1.0)  # noqa: E731
    if batch:
        # A line already voiced on its own (cached) is used as is; the rest go two consecutive lines per request
        # (a long pause between), cut apart at the pauses — about half the requests of one line each.
        todo = [ln for ln in lines if not gem.cached(ln.spoken, voice, ln.style)]
        runs: list[list[Line]] = []
        for ln in todo:
            if runs and runs[-1][-1].i == ln.i - 1:
                runs[-1].append(ln)
            else:
                runs.append([ln])
        takes: dict[int, tuple[np.ndarray, int]] = {}
        for ln in lines:
            if ln not in todo:
                x, r = read_wav(gem.cached(ln.spoken, voice, ln.style))  # type: ignore[arg-type]
                takes[ln.i] = (x if x.ndim == 1 else x.mean(axis=1), r)
        for run in runs:
            for grp in batch_groups(run):
                try:
                    for ln, tk in zip(grp, batch_takes(grp, gem, voice)):
                        takes[ln.i] = tk
                except Missing:
                    if not allow_missing:
                        raise
        for ln in lines:
            if ln.i not in takes:
                log(f"  line {ln.i}: not voiced yet (left silent in this preview)")
                ln.clip = None
                continue
            piece, rate = takes[ln.i]
            if True:
                ln.style = STYLE
                clip = process_clip((piece, rate))
                ln.raw_dur = len(clip) / SR
                if ln.raw_dur > budget(ln):
                    tempo = ln.raw_dur / budget(ln) * 1.005
                    ln.tempo = min(MAX_TEMPO, tempo)
                    clip = process_clip((piece, rate), ln.tempo)
                    if tempo > MAX_TEMPO:
                        log(f"  WARNING line {ln.i}: needs x{tempo:.3f} to fit, capped at x{MAX_TEMPO}")
                ln.clip = clip
    for ln in [] if batch else lines:
        path = gem.tts(ln.spoken, voice, ln.style)
        clip = process_clip(path)
        ln.raw_dur = len(clip) / SR
        if len(clip) / SR > budget(ln):
            log(f"  line {ln.i}: {len(clip) / SR:.2f} s > window {budget(ln):.2f} s; brisker take")
            path2 = gem.tts(ln.spoken, voice, STYLE_BRISK)
            clip2 = process_clip(path2)
            if len(clip2) < len(clip):
                clip, path, ln.style = clip2, path2, STYLE_BRISK
            ln.raw_dur = len(clip) / SR
        if len(clip) / SR > budget(ln):
            tempo = len(clip) / SR / budget(ln) * 1.005
            ln.tempo = min(MAX_TEMPO, tempo)
            clip = process_clip(path, ln.tempo)
            if tempo > MAX_TEMPO:
                log(f"  WARNING line {ln.i}: needs x{tempo:.3f} to fit, capped at x{MAX_TEMPO}")
        ln.clip = clip
    vo = np.zeros(int(math.ceil(total * SR)), np.float32)
    prev_end = 0.0
    for ln in lines:
        if ln.clip is None:
            ln.start = ln.end = ln.t
            continue
        start = ln.t
        dur = len(ln.clip) / SR  # type: ignore[arg-type]
        if start + dur > ln.next_t - 0.25 and ln.next_t < total:  # still over: borrow slack from before (never overlap)
            start = max(prev_end + 0.25, ln.next_t - 0.25 - dur)
        ln.start, ln.end = start, start + dur
        a = int(round(start * SR))
        vo[a : a + len(ln.clip)] += ln.clip[: len(vo) - a]  # type: ignore[index]
        prev_end = ln.end
    return vo


# ─── Verification helpers ────────────────────────────────────────────────────


def ebur128(path: Path) -> dict:
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-map", "0:a:0", "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"], capture_output=True, text=True)
    txt = r.stderr[r.stderr.rfind("Summary:") :]
    grab = lambda pat: float(re.search(pat, txt, re.S).group(1))  # noqa: E731
    return {"I": grab(r"I:\s+(-?[\d.]+) LUFS"), "LRA": grab(r"LRA:\s+(-?[\d.]+) LU"), "TP": grab(r"True peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS")}


def loudnorm_two_pass(src: Path, dst: Path) -> dict:
    base = f"loudnorm=I={TARGET_LUFS}:TP={TARGET_TP}:LRA=20"
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(src), "-af", base + ":print_format=json", "-f", "null", "-"], capture_output=True, text=True, check=True)
    m1 = json.loads(r.stderr[r.stderr.rfind("{") : r.stderr.rfind("}") + 1])
    af = base + (f":measured_I={m1['input_i']}:measured_TP={m1['input_tp']}:measured_LRA={m1['input_lra']}:measured_thresh={m1['input_thresh']}:offset={m1['target_offset']}:linear=true:print_format=json")
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-y", "-i", str(src), "-af", af, "-ar", str(SR), "-c:a", "pcm_s24le", str(dst)], capture_output=True, text=True, check=True)
    m2 = json.loads(r.stderr[r.stderr.rfind("{") : r.stderr.rfind("}") + 1])
    return {"pass1": m1, "pass2": m2}


def probe_duration(path: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)], capture_output=True, text=True)
    return float(r.stdout.strip())


def video_duration(path: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets,r_frame_rate", "-of", "json", str(path)], capture_output=True, text=True, check=True)
    st = json.loads(r.stdout)["streams"][0]
    num, den = (int(v) for v in st["r_frame_rate"].split("/"))
    return int(st["nb_read_packets"]) * den / num


def mux(video: Path, audio: Path, out: Path, dur: float) -> None:
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(video), "-i", str(audio), "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "224k", "-ar", str(SR), "-t", f"{dur:.3f}", "-movflags", "+faststart", str(out)],
        check=True,
    )


NUM = {w: i for i, w in enumerate("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split())}
NUM.update({w: 10 * i for i, w in enumerate("_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()) if w != "_"})


def norm_words(s: str) -> list[str]:
    s = s.lower().replace("₹", " rupees ").replace("’", "'")
    s = re.sub(r"snap[\s-]*(?:2|two|to)[\s-]*shelf", "snap2shelf", s)
    s = re.sub(r"(\w)\.(?=\w)", r"\1 dot ", s)
    s = re.sub(r"(\d),(\d{3})", r"\1\2", s)
    s = re.sub(r"read-?me", "readme", s)
    s = s.replace("-", " ")
    words = re.findall(r"[a-z0-9']+", s)
    out: list[str] = []
    i = 0
    while i < len(words):  # number words -> digits ("thirty five" -> 35, "two thousand five hundred" -> 2500)
        if words[i] in NUM:
            total, cur = 0, 0
            while i < len(words) and (words[i] in NUM or words[i] in ("hundred", "thousand")):
                w = words[i]
                if w == "hundred":
                    cur *= 100
                elif w == "thousand":
                    total += cur * 1000
                    cur = 0
                else:
                    cur += NUM[w]
                i += 1
            out.append(str(total + cur))
            continue
        out.append(words[i])
        i += 1
    return out


def plot_mix(mix: np.ndarray, vo: np.ndarray, lines: list[Line], cues: list[Cue], segs: list[Segment], path: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    t = np.arange(len(mix)) / SR
    fig, ax = plt.subplots(3, 1, figsize=(22, 10), sharex=True, gridspec_kw={"height_ratios": [2, 1, 2]})
    step = 200
    mono = mix.mean(axis=1)
    env_hi = maximum_filter1d(mono, step)[::step]
    env_lo = minimum_filter1d(mono, step)[::step]
    ax[0].fill_between(t[::step], env_lo, env_hi, color="#3b6ea5", lw=0)
    ax[0].axhline(db(-1), color="r", lw=0.6, ls="--")
    ax[0].axhline(-db(-1), color="r", lw=0.6, ls="--")
    ax[0].set_ylim(-1.05, 1.05)
    ax[0].set_title("mix waveform (dashed: -1 dBFS)")
    for ln in lines:
        ax[0].axvspan(ln.start, ln.end, color="#f5a524", alpha=0.12, lw=0)
    for c in cues:
        ax[0].axvline(c.at, color={"whoosh": "#888", "chime": "g", "tick": "m", "fan": "m", "pop": "c"}[c.kind], lw=0.5)
    # short-term loudness-ish: 3 s RMS in dB of mix and the voice
    for x, col, lab in ((mono, "#3b6ea5", "mix"), (vo, "#f5a524", "voice")):
        p = uniform_filter1d(x.astype(np.float64) ** 2, int(3 * SR))[::step]
        ax[1].plot(t[::step], 10 * np.log10(p + 1e-12), color=col, lw=0.8, label=lab)
    ax[1].set_ylim(-60, 0)
    ax[1].legend(loc="lower left")
    ax[1].set_title("3 s RMS (dBFS)")
    f, tt, S = signal.spectrogram(mono, fs=SR, nperseg=2048, noverlap=1024)
    ax[2].pcolormesh(tt, f, 10 * np.log10(S + 1e-14), shading="auto", vmin=-130, vmax=-40, cmap="magma")
    ax[2].set_yscale("symlog", linthresh=500)
    ax[2].set_ylim(30, 20000)
    ax[2].set_title("spectrogram")
    for s in segs:
        for a in ax:
            a.axvline(s.start, color="k", lw=0.4, alpha=0.4)
        ax[0].text(s.start + 0.3, 0.92, s.name, fontsize=8)
    ax[2].set_xlabel("seconds")
    fig.tight_layout()
    fig.savefig(path, dpi=80)
    plt.close(fig)


def update_cue_sheet(path: Path, lines: list[Line], voice: str, section: str) -> None:
    txt = path.read_text(encoding="utf-8")
    start, end = "<!-- voiceover.py:begin -->", "<!-- voiceover.py:end -->"
    block = f"{start}\n{section}\n{end}"
    if start in txt:
        txt = re.sub(re.escape(start) + r".*?" + re.escape(end), lambda _: block, txt, flags=re.S)
    else:
        txt = txt.rstrip() + "\n\n" + block + "\n"
    path.write_text(txt, encoding="utf-8")


CREDITS = "Voice-over: AI-generated with Google Gemini text-to-speech. Music and sound effects: generated procedurally for this video.\n"


# ─── Main ────────────────────────────────────────────────────────────────────


def audition(lines: list[Line], gem: Gemini, work: Path) -> None:
    first = lines[0]
    clips = []
    log(f"audition on line 1: {first.spoken!r}")
    for v in AUDITION_VOICES:
        c = process_clip(gem.tts(first.spoken, v, first.style))
        clips.append(c)
        f, pxx = signal.welch(c, fs=SR, nperseg=4096)
        band = lambda a, b: pxx[(f >= a) & (f < b)].sum()  # noqa: E731
        artic = band(1000, 4000) / band(100, 8000)
        cent = (f * pxx).sum() / pxx.sum()
        words = len(first.text.split())
        log(f"  {v:10s} {len(c) / SR:5.2f} s  {words / (len(c) / SR):.2f} w/s  1-4 kHz share {artic:.2f}  centroid {cent:5.0f} Hz")
        write_wav(work / f"audition_{v}.wav", c)
    gap = np.zeros(int(1.2 * SR), np.float32)
    joined = np.concatenate([x for c in clips for x in (c, gap)])
    buf = io.BytesIO()
    lo = signal.resample_poly(joined, 1, 3)  # 16 kHz for the listener
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes((np.clip(lo / np.abs(lo).max() * 0.9, -1, 1) * 32767).astype("<i2").tobytes())
    prompt = (
        f"This audio holds {len(clips)} narrator auditions for a product-demo video, separated by silence, in this order: "
        + ", ".join(f"{i + 1}" for i in range(len(clips)))
        + f'. Each should say: "{first.text}". For each clip give: the verbatim transcript, and scores 1-10 for clarity/enunciation, '
        "warmth, confidence and naturalness, and one short note on any problem (mispronounced name, clipped word, robotic prosody). "
        'Reply as a JSON list of objects {"clip":n,"transcript":...,"clarity":n,"warmth":n,"confidence":n,"naturalness":n,"note":...}.'
    )
    out = gem.listen("audition", buf.getvalue(), prompt, json_out=True)
    try:
        for v, row in zip(AUDITION_VOICES, json.loads(out)):
            log(f"  {v:10s} clarity {row.get('clarity')} warmth {row.get('warmth')} confidence {row.get('confidence')} naturalness {row.get('naturalness')} | {row.get('transcript')} | {row.get('note')}")
    except Exception:
        log("  judge: " + out[:1500])
    log(f"requests this run: {sum(1 for r in gem.requests if r['status'] == 'ok')} ok, {len(gem.requests)} total")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=None, help="the video folder (default: the 'video' folder beside the repo)")
    ap.add_argument("--voice", default=VOICE)
    ap.add_argument("--tts-model", default=TTS_MODEL, help=f"Gemini TTS model (default {TTS_MODEL}; each model has its own daily quota)")
    ap.add_argument("--per-line", action="store_true", help="one request per line (default: 3-4 consecutive lines per request, cut apart at the pauses)")
    ap.add_argument("--audition", action="store_true", help="audition the prebuilt voices on the first line, then stop")
    ap.add_argument("--offline", action="store_true", help="never call Gemini: a cache miss is an error")
    ap.add_argument("--no-transcribe", action="store_true", help="skip the one-call intelligibility check")
    ap.add_argument("--allow-missing", action="store_true", help="with --offline: leave lines that aren't voiced yet silent and write '-preview' files instead of the finals")
    args = ap.parse_args()

    video = Path(args.out).resolve() if args.out else default_out()
    if ROOT in video.parents or video == ROOT:
        raise SystemExit(f"refusing to write media inside the repo ({video})")
    work = video / "work" / "audio"
    work.mkdir(parents=True, exist_ok=True)
    picture, captioned = video / PICTURE_NAME, video / CAPTIONED_NAME
    total = video_duration(picture)
    lines, segs = parse_cue_sheet(video / CUE_NAME)
    narrate(lines, total)
    gem = Gemini(video, work / "tts_cache", args.offline, args.tts_model)
    log(f"{len(lines)} lines, {len(segs)} segments, picture {total:.3f} s, voice {args.voice}, model {args.tts_model}")
    if args.audition:
        audition(lines, gem, work)
        return

    # 1. voice
    vo = build_vo(lines, gem, args.voice, total, batch=not args.per_line, allow_missing=args.allow_missing)
    missing = [ln.i for ln in lines if ln.clip is None]
    sfx_name = "-preview" if missing else ""
    if missing:
        log(f"PREVIEW: lines {missing} are not voiced yet; writing *-preview files, not the finals")
    # 2. music + sfx
    music = render_music(total, segs)
    cues = sfx_cues(segs)
    sfx = render_sfx(total, cues)
    n = min(len(vo), len(music), len(sfx))
    vo, music, sfx = vo[:n], music[:n], sfx[:n]

    # 3. levels: voice to ~-14.5 LUFS; bed alone to BED_LUFS; ducked under the voice by DUCK_DB
    vo2 = np.stack([vo, vo], axis=1) * db(-3.0)
    vo2 *= db(-14.6 - lufs(vo2))
    speaking = speech_mask(vo)
    music *= db(BED_LUFS - lufs(music, mask=~speaking))
    duck_env = smooth_gate(speaking, attack=0.2, release=0.3, lookahead=0.18)
    duck =(10 ** (-DUCK_DB * duck_env / 20)).astype(np.float32)[:, None]
    music_d = music * duck
    sfx = sfx * db(-3.0)
    pre = vo2 + music_d + sfx
    # 4. master: gain to target, true-peak safety limiter, then ffmpeg loudnorm (two-pass, linear)
    g = db(float(np.clip(TARGET_LUFS - 0.2 - lufs(pre), -1.5, 1.5)))  # a trim: the voice sets the level
    pre *= g
    pre_l, gr_db = true_peak_limit(pre, TARGET_TP - 0.6)
    write_wav(work / "premaster.wav", pre_l, codec="pcm_f32le")
    ln = loudnorm_two_pass(work / "premaster.wav", video / f"mix{sfx_name}.wav")
    mix, _ = read_wav(video / f"mix{sfx_name}.wav")
    mix = mix[:n]
    g2 = float(np.sqrt((mix.astype(np.float64) ** 2).mean() / max(1e-12, (pre_l.astype(np.float64) ** 2).mean())))
    stem_gain = g * g2
    write_wav(video / f"vo_only{sfx_name}.wav", vo2 * stem_gain)
    write_wav(video / f"music_only{sfx_name}.wav", music_d * stem_gain)
    write_wav(video / f"sfx_only{sfx_name}.wav", sfx * stem_gain)
    write_wav(work / "music_bed_unducked.wav", music * stem_gain)

    # 5. mux
    final, final_c = video / FINAL_NAME.replace(".mp4", f"{sfx_name}.mp4"), video / FINAL_CAPTIONED_NAME.replace(".mp4", f"{sfx_name}.mp4")
    mux(picture, video / f"mix{sfx_name}.wav", final, total)
    mux(captioned, video / f"mix{sfx_name}.wav", final_c, total)
    (video / "CREDITS.txt").write_text(CREDITS, encoding="utf-8")

    # 6. checks
    rep: dict = {"voice": args.voice, "model": args.tts_model, "limiter_max_gr_db": round(gr_db, 2), "loudnorm": ln["pass2"].get("normalization_type")}
    rep["final"] = ebur128(final)
    rep["final_captioned"] = ebur128(final_c)
    rep["mix_wav"] = ebur128(video / f"mix{sfx_name}.wav")
    ms = stem_gain
    rep["bed_alone_lufs"] = round(lufs(music * ms, mask=~speaking), 1)
    rep["bed_under_vo_lufs"] = round(lufs(music_d * ms, mask=speaking), 1)
    rep["vo_lufs"] = round(lufs(vo2 * ms), 1)
    rep["mix_sample_peak_dbfs"] = round(20 * np.log10(np.abs(mix).max()), 2)
    rows = []
    overlaps = []
    for k, l in enumerate(lines):
        win_end = l.next_t
        rows.append({"line": l.i, "seg": l.seg, "cue": round(l.t, 2), "start": round(l.start, 2), "end": round(l.end, 2), "window_end": round(win_end, 2), "spare": round(win_end - l.end, 2), "tempo": round(l.tempo, 3), "style": "brisk" if l.style == STYLE_BRISK else ("outro" if l.style == STYLE_OUTRO else "base"), "text": l.text})
        if k and l.start < lines[k - 1].end:
            overlaps.append((lines[k - 1].i, l.i))
    rep["timeline"] = rows
    rep["overlaps"] = overlaps
    rep["cues"] = [{"at": round(c.at, 2), "kind": c.kind, "note": c.note} for c in cues]
    plot_mix(mix, vo2[:, 0] * ms, lines, cues, segs, video / f"mix_waveform{sfx_name}.png")

    if not args.no_transcribe:
        lo = signal.resample_poly(vo2[:, 0] * ms, 1, 3)
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes((np.clip(lo / np.abs(lo).max() * 0.9, -1, 1) * 32767).astype("<i2").tobytes())
        prompt = (
            "Transcribe this narration verbatim, exactly as spoken, one line per sentence. Write numbers the way they are spoken "
            "(in words). After the transcript, add a line '---' and then list any word that sounds mispronounced, clipped, slurred "
            "or unclear (with the words around it), or write 'none'."
        )
        out = gem.listen("vo", buf.getvalue(), prompt)
        heard, _, issues = out.partition("---")
        script = " ".join(l.text for l in lines)
        a, b = norm_words(script), norm_words(heard)
        sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
        diffs = [(op, " ".join(a[i1:i2]), " ".join(b[j1:j2])) for op, i1, i2, j1, j2 in sm.get_opcodes() if op != "equal"]
        errs = sum(max(i2 - i1, j2 - j1) for op, i1, i2, j1, j2 in sm.get_opcodes() if op != "equal")
        rep["transcript"] = {"wer": round(errs / max(1, len(a)), 4), "diffs": diffs, "issues": issues.strip(), "heard": heard.strip()}
    rep["requests"] = {"this_run_ok": sum(1 for r in gem.requests if r["status"] == "ok"), "this_run_total": len(gem.requests), "all_time": sum(1 for _ in (work / "tts_cache" / "requests.jsonl").open(encoding="utf-8")) if (work / "tts_cache" / "requests.jsonl").exists() else 0}
    (work / "report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1, default=float), encoding="utf-8")

    # 7. cue sheet section
    changed = [l for l in lines if l.changes]
    sec = [
        "## Voice-over (generated)",
        "",
        f"Voiced by `scripts/media/voiceover.py` (`npm run media:audio`): Google Gemini TTS `{args.tts_model}`, prebuilt voice **{args.voice}** (chosen from an audition of {', '.join(AUDITION_VOICES)} on the first line), style prompt \"{STYLE}\". A neutral AI narrator: it never claims to be a person. Music and sound effects are synthesised by the same script (no samples, nothing downloaded).",
        "",
        "Narration changes from the table above: " + ("; ".join(f"line {l.i}: {', '.join(l.changes)}" for l in changed) if changed else "none") + ".",
        "",
        "| # | Cue | Starts | Ends | Window ends | Spare | Tempo | Line as voiced |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        sec.append(f"| {r['line']} | {tc(r['cue'])} | {r['start']:.2f} s | {r['end']:.2f} s | {r['window_end']:.2f} s | {r['spare']:.2f} s | ×{r['tempo']:.2f}{' brisk' if r['style'] == 'brisk' else ''} | {r['text']} |")
    f = rep["final"]
    sec += ["", f"Final mix: {f['I']:.1f} LUFS integrated, {f['TP']:.1f} dBTP true peak, LRA {f['LRA']:.1f} LU (bed alone {rep['bed_alone_lufs']} LUFS, under the voice {rep['bed_under_vo_lufs']} LUFS). Credits line: `CREDITS.txt`."]
    if not missing:  # a preview never rewrites the cue sheet
        update_cue_sheet(video / CUE_NAME, lines, args.voice, "\n".join(sec))

    # 8. print
    log(f"final: I {f['I']} LUFS, TP {f['TP']} dBTP, LRA {f['LRA']} LU  (loudnorm {rep['loudnorm']}, limiter max {gr_db:.2f} dB)")
    log(f"bed alone {rep['bed_alone_lufs']} LUFS, under the voice {rep['bed_under_vo_lufs']} LUFS, voice {rep['vo_lufs']} LUFS")
    if rep["loudnorm"] != "linear" or f["TP"] > TARGET_TP or abs(f["I"] - TARGET_LUFS) > 0.5:
        log(f"WARNING: master is off target (loudnorm {rep['loudnorm']}, I {f['I']}, TP {f['TP']})" + (" — expected in a preview, most of the voice is missing" if missing else ""))
    for r in rows:
        flag = "" if r["spare"] >= 0.25 or r["line"] == len(rows) else "  <-- tight"
        log(f"  {r['line']:2d} {r['seg']:7s} cue {r['cue']:7.2f}  {r['start']:7.2f}-{r['end']:7.2f}  window {r['window_end']:7.2f}  spare {r['spare']:5.2f}  x{r['tempo']:.3f} {r['style']}{flag}")
    log(f"overlaps: {overlaps or 'none'}")
    if "transcript" in rep:
        log(f"transcript WER {rep['transcript']['wer']:.3f}; diffs: {rep['transcript']['diffs']}")
        log(f"listener notes: {rep['transcript']['issues'][:600]}")
    log(f"requests: {rep['requests']}")
    for p in (final, final_c, video / f"mix{sfx_name}.wav", video / f"vo_only{sfx_name}.wav", video / f"music_only{sfx_name}.wav", video / f"sfx_only{sfx_name}.wav"):
        log(f"  {p.name}: {p.stat().st_size / 1048576:.1f} MB, {probe_duration(p):.3f} s")


if __name__ == "__main__":
    main()
