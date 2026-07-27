"use client";

import { useCallback, useEffect, useState } from "react";
import EnhancePanel from "@/components/EnhancePanel";
import IntakePanel from "@/components/IntakePanel";
import MemoryPane, { type MemoryPayload } from "@/components/MemoryPane";

// Two modes, one memory. Intake puts information in; Enhance spends it against
// a specific posting. The memory pane is always reachable because it is the
// thing that makes the other two work.

type Mode = "intake" | "enhance";

export default function Home() {
  const [mode, setMode] = useState<Mode>("enhance");
  const [memory, setMemory] = useState<MemoryPayload | null>(null);
  const [resumes, setResumes] = useState<string[]>([]);
  const [showMemory, setShowMemory] = useState(false);

  const loadMemory = useCallback(() => {
    fetch("/api/memory")
      .then((r) => r.json())
      .then(setMemory)
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadMemory();
    fetch("/api/resumes")
      .then((r) => r.json())
      .then((d) => setResumes(d.resumes ?? []))
      .catch(() => {});
  }, [loadMemory]);

  const memoryEmpty = (memory?.memory.entities.length ?? 0) === 0;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-10">
      {memory?.demo && (
        <div className="mb-6 border-2 border-dropped-ink bg-dropped p-4 text-dropped-ink">
          <p className="text-sm font-bold uppercase tracking-wide">
            ⚠ Demo mode — no AI is running
          </p>
          <p className="mt-1 text-xs leading-5">
            No <code>ANTHROPIC_API_KEY</code> was found, so extraction and tailoring are
            being done by hand-written keyword rules, not a model. Parsing, the memory
            graph, diffing, the number audit and .docx export are all real — only the
            judgment is fake. Add your key to <code>.env.local</code> and restart the dev
            server for the actual product.
          </p>
        </div>
      )}

      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-5xl tracking-tight">Resume Enhancer</h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
            A knowledge base of everything you&apos;ve done, spent against one job
            posting at a time. It decides what belongs on the page, in which section,
            in what order — and it cannot write a number you never gave it.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <div className="flex border-2 border-foreground">
            {(["intake", "enhance"] as const).map((m) => (
              <button
                key={m}
                className={`px-4 py-1.5 font-bold ${
                  mode === m ? "bg-foreground text-background" : "hover:bg-surface"
                }`}
                onClick={() => setMode(m)}
              >
                {m === "intake" ? "Intake" : "Enhance"}
              </button>
            ))}
          </div>
          <button
            className="underline underline-offset-8"
            onClick={() => setShowMemory((v) => !v)}
          >
            {showMemory ? "hide memory" : "memory"}
            <span className="ml-1 text-xs text-muted">
              ({memory?.stats.entities ?? 0}e/{memory?.stats.facts ?? 0}f)
            </span>
          </button>
        </div>
      </header>

      <div
        className={
          showMemory
            ? "grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
            : "grid gap-6"
        }
      >
        <main className="border border-line bg-surface p-5">
          <h2 className="mb-4 text-[15px] font-bold">
            {mode === "intake" ? "Intake — add to memory" : "Enhance — tailor to a posting"}
          </h2>
          {mode === "intake" ? (
            <IntakePanel resumes={resumes} onIngested={loadMemory} />
          ) : (
            <EnhancePanel
              resumes={resumes}
              memoryEmpty={memoryEmpty}
              onGoToIntake={() => setMode("intake")}
            />
          )}
        </main>

        {showMemory && (
          <aside className="border border-line bg-surface p-5">
            <h2 className="mb-4 text-[15px] font-bold">
              Memory — everything the system knows about you
            </h2>
            <MemoryPane payload={memory} onSaved={setMemory} />
          </aside>
        )}
      </div>
    </div>
  );
}
