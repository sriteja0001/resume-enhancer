"use client";

import { useState } from "react";

// Intake mode: the only job here is getting information INTO memory. No
// tailoring, no resume rendering — you paste, it extracts, memory grows.

interface Props {
  resumes: string[];
  onIngested: () => void;
}

const PROMPTS = [
  "Walk through your last role: what did you build, who used it, what changed because of it?",
  "List every course you've taken that isn't already in memory, with the subject area.",
  "What numbers do you know about your work? Users, revenue, latency, accuracy, team size, time saved.",
  "What have you built outside of work or school — side projects, ventures, content?",
  "What are you optimizing for in your next role, and what do you want to stop doing?",
];

export default function IntakePanel({ resumes, onIngested }: Props) {
  const [text, setText] = useState("");
  const [label, setLabel] = useState("intake");
  const [resume, setResume] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Intake failed");
      setResult(
        `+${data.addedEntities} entities, +${data.addedFacts} facts, +${data.addedItems} items. ${data.summary}`
      );
      setText("");
      onIngested();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Intake failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-xs text-muted">
            paste anything about yourself — resume text, a brain-dump, a project
            description, an answer to a question below
          </label>
          <textarea
            className="min-h-56 w-full border border-line bg-white p-3 font-mono text-xs leading-5 focus:border-foreground focus:outline-none"
            placeholder="I spent last summer building an agent harness for campaign automation. It ran 200+ content cycles and we grew the Udemy community to 24K…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">label this source</span>
          <input
            className="w-40 border border-line bg-white px-2 py-1 font-mono focus:border-foreground focus:outline-none"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button
            className="border-2 border-foreground bg-background px-6 py-1.5 font-bold shadow-[3px_3px_0_0_var(--foreground)] transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-40"
            disabled={busy || !text.trim()}
            onClick={() => send({ text, label })}
          >
            {busy ? "extracting…" : "add to memory"}
          </button>
        </div>
      </div>

      <div className="border-t border-line pt-4">
        <p className="mb-2 text-xs text-muted">
          or absorb an entire resume from data/resumes/ — everything in it becomes
          memory, so future tailoring can draw on it even when you start from a
          different resume
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            className="border border-line bg-white px-2 py-1.5 font-mono focus:border-foreground focus:outline-none"
            value={resume}
            onChange={(e) => setResume(e.target.value)}
          >
            <option value="">— pick a resume —</option>
            {resumes.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button
            className="border border-foreground px-4 py-1.5 font-bold disabled:opacity-40"
            disabled={busy || !resume}
            onClick={() => send({ resume })}
          >
            absorb resume
          </button>
        </div>
      </div>

      {result && (
        <p className="border border-added-ink bg-added p-3 text-xs leading-5 text-added-ink">
          {result}
        </p>
      )}
      {error && (
        <p className="border-2 border-dropped-ink bg-dropped p-3 text-xs font-bold text-dropped-ink">
          {error}
        </p>
      )}

      <div className="border-t border-line pt-4">
        <p className="mb-2 text-xs font-bold uppercase tracking-wide">
          Questions worth answering
        </p>
        <ul className="flex flex-col gap-1.5 text-xs text-muted">
          {PROMPTS.map((p) => (
            <li key={p}>
              <button
                className="text-left leading-5 hover:text-foreground"
                onClick={() => setText((t) => (t ? `${t}\n\n${p}\n` : `${p}\n`))}
              >
                · {p}
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] leading-4 text-muted">
          The more numbers you record here, the more the enhancer can say later —
          it is structurally incapable of writing a metric you never gave it.
        </p>
      </div>
    </div>
  );
}
