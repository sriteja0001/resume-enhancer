"use client";

import { useState } from "react";
import type { MemoryStats } from "@/lib/memory/graph";
import type { Memory } from "@/lib/memory/types";

// Everything the system knows about you, in the file it actually reads.
// Two views of the same thing: a structured browse, and the raw master.md
// you can edit by hand and save.

export interface MemoryPayload {
  markdown: string;
  memory: Memory;
  stats: MemoryStats;
  demo: boolean;
}

interface Props {
  payload: MemoryPayload | null;
  onSaved: (payload: MemoryPayload) => void;
}

export default function MemoryPane({ payload, onSaved }: Props) {
  const [view, setView] = useState<"browse" | "raw">("browse");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");

  // Re-seed the editor when the file changes underneath us (an intake run, a
  // save), tracked by comparing the source rather than via an effect.
  const [seededFrom, setSeededFrom] = useState<string | null>(null);
  if (payload && payload.markdown !== seededFrom) {
    setSeededFrom(payload.markdown);
    setDraft(payload.markdown);
  }

  if (!payload) return <p className="text-sm text-muted">Loading memory…</p>;

  const { memory, stats } = payload;
  const dirty = draft !== payload.markdown;

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown: draft }),
      });
      if (res.ok) onSaved(await res.json());
    } finally {
      setSaving(false);
    }
  };

  const q = filter.trim().toLowerCase();
  const entities = q
    ? memory.entities.filter((e) =>
        [e.title, e.org, e.role, ...e.domains, ...e.skills, ...e.facts.map((f) => f.text), ...e.items.map((i) => i.text)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q)
      )
    : memory.entities;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {[
          ["entities", stats.entities],
          ["facts", stats.facts],
          ["items", stats.items],
          ["with metrics", stats.metrics],
        ].map(([label, value]) => (
          <div key={label as string} className="border border-line bg-background p-2">
            <div className="text-lg font-bold">{value as number}</div>
            <div className="text-muted">{label as string}</div>
          </div>
        ))}
      </div>

      {(memory.identity.name ||
        memory.identity.email ||
        memory.identity.links.length > 0) && (
        <div className="border border-line bg-background p-3 text-xs">
          <p className="mb-1 text-muted">
            identity — used as the resume header when a file doesn&apos;t carry one
          </p>
          {memory.identity.name && (
            <p className="text-sm font-bold">{memory.identity.name}</p>
          )}
          <p className="leading-5 text-muted">
            {[
              memory.identity.email,
              memory.identity.phone,
              memory.identity.location,
              ...memory.identity.links,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      )}

      {stats.domains.length > 0 && (
        <div className="text-xs">
          <p className="mb-1 text-muted">
            domain coverage — these tags are what tailoring retrieves on
          </p>
          <div className="flex flex-wrap gap-1">
            {stats.domains.slice(0, 24).map((d) => (
              <span key={d.tag} className="border border-line bg-background px-1.5 py-0.5">
                {d.tag} <span className="text-muted">{d.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-b border-line pb-2 text-xs">
        {(["browse", "raw"] as const).map((v) => (
          <button
            key={v}
            className={`underline-offset-4 ${view === v ? "font-bold underline" : "text-muted"}`}
            onClick={() => setView(v)}
          >
            {v === "browse" ? "browse" : "raw master.md"}
          </button>
        ))}
        <span className="ml-auto text-muted">data/memory/master.md</span>
      </div>

      {view === "browse" ? (
        <div className="flex flex-col gap-3">
          <input
            className="border border-line bg-white px-2 py-1.5 font-mono text-xs focus:border-foreground focus:outline-none"
            placeholder="filter entities, facts, skills, domains…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {entities.length === 0 && (
            <p className="border border-dashed border-line p-4 text-sm text-muted">
              {memory.entities.length === 0
                ? "Memory is empty. Switch to Intake mode and paste anything about yourself — a resume, a brain-dump, a project description."
                : "No entities match that filter."}
            </p>
          )}
          {entities.map((e) => (
            <div key={e.id} className="border border-line bg-background p-3 text-xs">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-bold">{e.title}</span>
                <span className="text-muted">
                  {e.type}
                  {e.dates ? ` · ${e.dates}` : ""}
                </span>
              </div>
              {(e.role || e.org) && (
                <p className="text-muted">{[e.role, e.org].filter(Boolean).join(" @ ")}</p>
              )}
              {(e.domains.length > 0 || e.skills.length > 0) && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {e.domains.map((d) => (
                    <span key={d} className="bg-moved px-1 text-[10px] text-moved-ink">
                      {d}
                    </span>
                  ))}
                  {e.skills.map((s) => (
                    <span key={s} className="border border-line px-1 text-[10px]">
                      {s}
                    </span>
                  ))}
                </div>
              )}
              {e.facts.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {e.facts.map((f) => (
                    <li key={f.id} className="leading-5">
                      · {f.text}
                      {f.metrics.length > 0 && (
                        <span className="ml-1 bg-added px-1 text-[10px] text-added-ink">
                          {f.metrics.join("; ")}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {e.items.length > 0 && (
                <div className="mt-2 flex flex-col gap-1">
                  {[...new Set(e.items.map((i) => i.kind))].map((kind) => (
                    <p key={kind} className="leading-5">
                      <span className="text-muted">{kind}: </span>
                      {e.items
                        .filter((i) => i.kind === kind)
                        .map((i) => i.text)
                        .join(", ")}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <textarea
            className="min-h-[28rem] w-full border border-line bg-white p-3 font-mono text-xs leading-5 focus:border-foreground focus:outline-none"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
          />
          <div className="flex items-center gap-3 text-xs">
            <button
              className="border-2 border-foreground px-4 py-1 font-bold disabled:opacity-40"
              disabled={!dirty || saving}
              onClick={save}
            >
              {saving ? "saving…" : "save master.md"}
            </button>
            {dirty && <span className="text-muted">unsaved changes</span>}
            <span className="ml-auto text-muted">
              this file is the source of truth — edit it freely
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
