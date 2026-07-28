"use client";

import { useEffect, useRef, useState } from "react";
import type { Session } from "@/lib/ai/session";
import { AuditWarnings, ChangeLog, CoverageMatrix, TargetCard } from "./Analytics";
import ResumeMockup from "./ResumeMockup";

// Enhance mode: pick a resume, paste the posting, get a rendered tailored
// resume with a chat beside it. Save writes a NEW .docx — your original file
// is never touched.

interface SessionMeta {
  id: string;
  createdAt: string;
  resumeFile: string;
  roleTitle: string;
  demo: boolean;
}

interface Props {
  resumes: string[];
  memoryEmpty: boolean;
  onGoToIntake: () => void;
}

export default function EnhancePanel({ resumes, memoryEmpty, onGoToIntake }: Props) {
  const [resume, setResume] = useState("");
  const [jd, setJd] = useState("");
  const [notes, setNotes] = useState("");
  const [charLimit, setCharLimit] = useState(200);
  const [session, setSession] = useState<Session | null>(null);
  const [history, setHistory] = useState<SessionMeta[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState("");
  const [tab, setTab] = useState<"coverage" | "changes">("coverage");
  const chatEnd = useRef<HTMLDivElement>(null);

  // Default to the first resume once the list arrives, without re-running on
  // every `resume` change (which would fight the user's own selection).
  const [pickedDefault, setPickedDefault] = useState(false);
  if (!pickedDefault && resumes.length > 0) {
    setPickedDefault(true);
    setResume(resumes[0]);
  }

  const loadHistory = () => {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((d) => setHistory(d.sessions ?? []))
      .catch(() => {});
  };
  // Braces matter: an effect must return a cleanup function or nothing, and a
  // bare `() => expr` body returns whatever the expression evaluates to.
  useEffect(() => {
    loadHistory();
  }, [session?.id]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.chat.length]);

  const run = async () => {
    setBusy("tailor");
    setError(null);
    try {
      const res = await fetch("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume, jobDescription: jd, charLimit, notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Tailoring failed");
      setSession(data as Session);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tailoring failed");
    } finally {
      setBusy(null);
    }
  };

  const sendChat = async () => {
    if (!session || !chatDraft.trim()) return;
    const message = chatDraft.trim();
    setChatDraft("");
    setBusy("chat");
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${session.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Edit failed");
      setSession(data as Session);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Edit failed");
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!session) return;
    setBusy("export");
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${session.id}/export`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${session.resumeFile.replace(/\.docx$/i, "")} — tailored.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(null);
    }
  };

  if (memoryEmpty) {
    return (
      <div className="border border-dashed border-line p-6 text-sm">
        <p className="mb-3 leading-6">
          Your memory is empty, and tailoring reads from memory rather than from the
          resume alone — that&apos;s what lets it surface a chemistry course your
          current resume doesn&apos;t list, or promote a venture out of Leadership.
        </p>
        <button
          className="border-2 border-foreground px-5 py-1.5 text-xs font-bold"
          onClick={onGoToIntake}
        >
          go to Intake mode
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* controls */}
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <label className="mb-1 block text-xs text-muted">base resume</label>
            <select
              className="w-full border border-line bg-white px-2 py-2 font-mono text-xs focus:border-foreground focus:outline-none"
              value={resume}
              onChange={(e) => setResume(e.target.value)}
            >
              {resumes.length === 0 && <option value="">no .docx in data/resumes/</option>}
              {resumes.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">chars/bullet</label>
            <input
              type="number"
              className="w-24 border border-line bg-white px-2 py-2 font-mono text-xs focus:border-foreground focus:outline-none"
              value={charLimit}
              onChange={(e) => setCharLimit(Number(e.target.value) || 200)}
            />
          </div>
          {history.length > 0 && (
            <select
              className="border border-line bg-white px-2 py-2 font-mono text-xs focus:border-foreground focus:outline-none"
              value={session?.id ?? ""}
              onChange={async (e) => {
                if (!e.target.value) return;
                const res = await fetch(`/api/sessions/${e.target.value}`);
                if (res.ok) setSession(await res.json());
              }}
            >
              <option value="">— past sessions —</option>
              {history.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.createdAt.slice(0, 16).replace("T", " ")} · {h.roleTitle.slice(0, 40)}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label className="mb-1 block text-xs text-muted">job posting</label>
          <textarea
            className="min-h-40 w-full border border-line bg-white p-2 font-mono text-xs leading-5 focus:border-foreground focus:outline-none"
            placeholder="Paste the full posting. The more of it you paste, the better the placement and selection decisions."
            value={jd}
            onChange={(e) => setJd(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <label className="mb-1 block text-xs text-muted">
              anything specific you want emphasized (optional)
            </label>
            <input
              className="w-full border border-line bg-white px-2 py-1.5 font-mono text-xs focus:border-foreground focus:outline-none"
              placeholder="lead with the startup; keep it to one page"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <button
            className="border-2 border-foreground bg-background px-8 py-2 font-bold shadow-[4px_4px_0_0_var(--foreground)] transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-40"
            disabled={!resume || !jd.trim() || busy !== null}
            onClick={run}
          >
            {busy === "tailor" ? "tailoring…" : "Tailor"}
          </button>
        </div>
      </div>

      {error && (
        <p className="border-2 border-dropped-ink bg-dropped p-3 text-xs font-bold text-dropped-ink">
          {error}
        </p>
      )}

      {session && (
        <>
          <TargetCard session={session} />
          <AuditWarnings session={session} />

          {/* mockup + chat, side by side */}
          <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wide">
                  Tailored resume — preview
                </h3>
                <button
                  className="border-2 border-foreground bg-background px-5 py-1 text-xs font-bold shadow-[3px_3px_0_0_var(--foreground)] transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-40"
                  disabled={busy !== null}
                  onClick={save}
                >
                  {busy === "export" ? "saving…" : "Save .docx"}
                </button>
              </div>
              <ResumeMockup doc={session.tailored} />
              <p className="text-[11px] leading-4 text-muted">
                Saving writes a new file to data/exports/ and downloads it. Your original{" "}
                {session.resumeFile} is opened read-only and never modified.
              </p>
            </div>

            <div className="flex max-h-[46rem] flex-col gap-2 border border-line bg-surface p-3">
              <h3 className="text-xs font-bold uppercase tracking-wide">
                Chat — tweak the resume
              </h3>
              <p className="text-[11px] leading-4 text-muted">
                &ldquo;move the startup above the lab&rdquo; · &ldquo;shorten the third
                bullet&rdquo; · &ldquo;swap in a chemistry course&rdquo; · &ldquo;make the
                Wellnest bullet lead with the metric&rdquo;
              </p>
              <div className="flex-1 overflow-y-auto">
                {session.chat.length === 0 && (
                  <p className="py-6 text-center text-[11px] text-muted">
                    No messages yet. Ask for a change and the document re-renders.
                  </p>
                )}
                <div className="flex flex-col gap-3 text-xs">
                  {session.chat.map((m, i) => (
                    <div
                      key={i}
                      className={
                        m.role === "user"
                          ? "border-l-2 border-foreground pl-2"
                          : "border-l-2 border-line pl-2 text-muted"
                      }
                    >
                      <div className="text-[10px] font-bold uppercase">
                        {m.role === "user" ? "you" : "enhancer"}
                      </div>
                      <p className="whitespace-pre-wrap leading-5">{m.content}</p>
                    </div>
                  ))}
                  <div ref={chatEnd} />
                </div>
              </div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  sendChat();
                }}
              >
                <input
                  className="flex-1 border border-line bg-white px-2 py-1.5 font-mono text-xs focus:border-foreground focus:outline-none"
                  placeholder="ask for a change…"
                  value={chatDraft}
                  onChange={(e) => setChatDraft(e.target.value)}
                />
                <button
                  className="border border-foreground px-3 py-1 text-xs font-bold disabled:opacity-40"
                  disabled={busy !== null || !chatDraft.trim()}
                >
                  {busy === "chat" ? "…" : "send"}
                </button>
              </form>
            </div>
          </div>

          {/* analytics */}
          <div className="flex flex-col gap-3 border-t border-line pt-4">
            <p className="text-xs leading-5">{session.strategy}</p>
            <div className="flex gap-4 border-b border-line pb-2 text-xs">
              {(["coverage", "changes"] as const).map((t) => (
                <button
                  key={t}
                  className={`underline-offset-4 ${tab === t ? "font-bold underline" : "text-muted"}`}
                  onClick={() => setTab(t)}
                >
                  {t === "coverage" ? "requirement coverage" : "change log"}
                </button>
              ))}
            </div>
            {tab === "coverage" ? (
              <CoverageMatrix session={session} />
            ) : (
              <ChangeLog session={session} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
