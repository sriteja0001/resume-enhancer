"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ProfilePanel from "@/components/ProfilePanel";
import RunPanel from "@/components/RunPanel";
import OutputPanel from "@/components/OutputPanel";
import type { Profile } from "@/lib/types";

// Single-page, three-panel layout (plan §7):
// profile (everything the system knows) | run | output + chat.

export default function Home() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty" | "error">("saved");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then(setProfile)
      .catch(() => setSaveState("error"));
  }, []);

  // Debounced autosave: every edit persists to data/profile.json ~1s after
  // typing stops. No save button to forget.
  const onProfileChange = useCallback((next: Profile) => {
    setProfile(next);
    setSaveState("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaveState("saving");
      try {
        const res = await fetch("/api/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
        setSaveState(res.ok ? "saved" : "error");
      } catch {
        setSaveState("error");
      }
    }, 1000);
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 font-sans dark:bg-zinc-950">
      <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <h1 className="text-lg font-semibold">Resume Enhancer</h1>
        <span className="text-xs text-zinc-400">
          {saveState === "saved" && "profile saved"}
          {saveState === "dirty" && "…"}
          {saveState === "saving" && "saving…"}
          {saveState === "error" && (
            <span className="text-red-500">profile save failed</span>
          )}
        </span>
      </header>

      <main className="grid flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[1.2fr_1fr_1fr]">
        <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Profile — everything the system knows
          </h2>
          {profile ? (
            <ProfilePanel profile={profile} onChange={onProfileChange} />
          ) : (
            <p className="text-sm text-zinc-400">Loading…</p>
          )}
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Run
          </h2>
          <RunPanel />
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Output
          </h2>
          <OutputPanel />
        </section>
      </main>
    </div>
  );
}
