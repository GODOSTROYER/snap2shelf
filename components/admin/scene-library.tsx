"use client";

import { KeyRound, LockOpen, Sun } from "lucide-react";
import * as React from "react";
import { CloudImg } from "@/components/cloud-img";
import { Button } from "@/components/ui/button";
import * as api from "@/lib/client/api";
import { publicUrl } from "@/lib/client/img";
import type { Scene } from "@/lib/types";

/** The scene library with each plate's Scene DNA drawn on top: where the surface is, where the light comes from. */
export function SceneLibrary() {
  const [unlocked, setUnlocked] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [scenes, setScenes] = React.useState<Scene[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoadError(null);
    try {
      const [a, b] = await Promise.all([api.scenes("eye-level"), api.scenes("top-down")]);
      setScenes([...a.data, ...b.data]);
    } catch (e) {
      setLoadError(api.messageFor(e));
    }
  }, []);

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return setError("Enter the access code.");
    setBusy(true);
    setError(null);
    try {
      await api.access(code.trim());
      setUnlocked(true);
      void load();
    } catch (err) {
      setError(api.messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  if (!unlocked) {
    return (
      <form onSubmit={unlock} className="mx-auto mt-10 grid max-w-sm gap-4 rounded-2xl bg-stage p-6 ring-1 ring-line">
        <p className="flex items-center gap-2 font-display text-lg font-semibold">
          <KeyRound className="size-5 text-marigold" aria-hidden />
          Access code required
        </p>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">Access code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            className="h-12 rounded-xl bg-stage-2 px-4 text-base ring-1 ring-line ring-inset focus:ring-marigold focus:outline-none"
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm text-sindoor">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={busy}>
          <LockOpen />
          {busy ? "Checking…" : "Open the library"}
        </Button>
      </form>
    );
  }

  if (loadError) {
    return (
      <div role="alert" className="mt-10 flex items-center gap-4 rounded-2xl bg-sindoor/10 p-4 text-sm ring-1 ring-sindoor/30">
        {loadError}
        <Button size="sm" variant="secondary" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    );
  }

  if (!scenes) {
    return (
      <ul className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5" aria-busy="true">
        {Array.from({ length: 10 }, (_, i) => (
          <li key={i} className="skeleton aspect-[4/5] rounded-2xl" />
        ))}
      </ul>
    );
  }

  if (!scenes.length) return <p className="mt-10 text-dim">No scenes in the library yet. Run the seeding script to add some.</p>;

  return (
    <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">
      {scenes.map((s) => (
        <li key={s.publicId}>
          <div className="relative overflow-hidden rounded-2xl ring-1 ring-line">
            <CloudImg src={publicUrl(s.publicId, { w: 400, h: 500, crop: "c_fill" })} alt={s.title} width={400} height={500} className="aspect-[4/5] w-full object-cover" />
            {/* anchor: where a product's base lands */}
            <span
              aria-hidden
              className="absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-marigold shadow-[0_0_0_4px_rgb(245_165_36/0.35)]"
              style={{ left: `${s.dna.anchor_x * 100}%`, top: `${s.dna.anchor_y * 100}%` }}
            />
            <span
              aria-hidden
              className="absolute h-0.5 -translate-y-1/2 bg-white/80"
              style={{ left: `${(s.dna.anchor_x - s.dna.surface_width / 2) * 100}%`, width: `${s.dna.surface_width * 100}%`, top: `${s.dna.anchor_y * 100}%` }}
            />
            <span aria-hidden className="absolute top-2 right-2 grid size-9 place-items-center rounded-full bg-studio/80" style={{ transform: `rotate(${s.dna.light_azimuth}deg)` }}>
              <Sun className="size-4 -translate-y-1 text-marigold" />
            </span>
          </div>
          <p className="mt-2 font-semibold">{s.title}</p>
          <p className="text-[0.8rem] text-dim">
            {s.view === "top-down" ? "Top-down" : "Eye level"}, light from {Math.round(s.dna.light_azimuth)}°, {s.dna.temperature}
            {s.dna.glossy ? ", glossy" : ""}
          </p>
          <p className="text-[0.8rem] text-faint">{s.credits ? `Made once for ${s.credits} credits` : "Reused"}</p>
        </li>
      ))}
    </ul>
  );
}
