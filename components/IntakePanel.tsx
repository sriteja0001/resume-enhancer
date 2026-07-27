"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Intake mode. Files are the unit of intake, not a textarea — the things
// worth remembering already live in documents: a research summary, a
// transcript, a running list of everything you did in high school. Drop them
// in and the app puts them where they belong.

interface SourceFile {
  name: string;
  bucket: "sources" | "resumes";
  bytes: number;
  modifiedAt: string;
  sha: string;
  kind: string;
  supported: boolean;
  status: "new" | "absorbed" | "changed";
  absorbed: { absorbedAt: string; entities: number; facts: number; items: number } | null;
}

interface Library {
  files: SourceFile[];
  supportedExtensions: string[];
  folders: { sources: string; resumes: string };
}

interface AbsorbResult {
  ok: boolean;
  file: string;
  error?: string;
  warning?: string | null;
  addedEntities?: number;
  addedFacts?: number;
  addedItems?: number;
  summary?: string;
}

interface Props {
  onIngested: () => void;
}

const STATUS_STYLE: Record<SourceFile["status"], string> = {
  new: "bg-added text-added-ink",
  absorbed: "border border-line text-muted",
  changed: "bg-rewritten text-rewritten-ink",
};

const STATUS_LABEL: Record<SourceFile["status"], string> = {
  new: "not absorbed",
  absorbed: "in memory",
  changed: "changed — re-absorb",
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function IntakePanel({ onIngested }: Props) {
  const [library, setLibrary] = useState<Library | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<AbsorbResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showText, setShowText] = useState(false);
  const [text, setText] = useState("");
  const [label, setLabel] = useState("note");
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    fetch("/api/sources")
      .then((r) => r.json())
      .then(setLibrary)
      .catch(() => setError("Could not read the file library"));
  }, []);
  useEffect(load, [load]);

  const key = (f: SourceFile) => `${f.bucket}/${f.name}`;

  const upload = async (files: FileList | File[], bucket: "sources" | "resumes") => {
    const list = [...files];
    if (list.length === 0) return;
    setBusy("upload");
    setError(null);
    try {
      const form = new FormData();
      form.append("bucket", bucket);
      for (const f of list) form.append("files", f);
      const res = await fetch("/api/sources", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setLibrary(data);
      if (data.rejected?.length) {
        setError(
          data.rejected
            .map((r: { name: string; reason: string }) => `${r.name}: ${r.reason}`)
            .join(" · ")
        );
      }
      // Pre-select what just landed so "absorb" is the obvious next click.
      setSelected(new Set((data.saved ?? []).map((n: string) => `${bucket}/${n}`)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  };

  const absorb = async (files: SourceFile[]) => {
    if (files.length === 0) return;
    setBusy("absorb");
    setError(null);
    setResults([]);
    try {
      const res = await fetch("/api/sources/absorb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: files.map((f) => ({ name: f.name, bucket: f.bucket })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Absorb failed");
      setResults(data.results ?? []);
      setSelected(new Set());
      load();
      onIngested();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Absorb failed");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (f: SourceFile) => {
    setBusy(key(f));
    try {
      const res = await fetch(
        `/api/sources?name=${encodeURIComponent(f.name)}&bucket=${f.bucket}`,
        { method: "DELETE" }
      );
      if (res.ok) setLibrary(await res.json());
    } finally {
      setBusy(null);
    }
  };

  const files = library?.files ?? [];
  const pending = files.filter((f) => f.status !== "absorbed" && f.supported);
  const chosen = files.filter((f) => selected.has(key(f)));

  return (
    <div className="flex flex-col gap-6">
      {/* drop zone — the primary surface */}
      <div
        className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed p-10 text-center transition-colors ${
          dragging ? "border-foreground bg-added" : "border-line bg-background"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          upload(e.dataTransfer.files, "sources");
        }}
      >
        <p className="text-base font-bold">
          {busy === "upload" ? "uploading…" : "Drop your documents here"}
        </p>
        <p className="max-w-lg text-xs leading-5 text-muted">
          Research summaries, a list of everything you did in high school,
          project write-ups, transcripts, old resumes — anything that describes
          what you&apos;ve done. Supported:{" "}
          {(library?.supportedExtensions ?? [".docx", ".md", ".txt", ".pdf"]).join(", ")}
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-center gap-3 text-xs">
          <button
            className="border-2 border-foreground bg-background px-5 py-1.5 font-bold shadow-[3px_3px_0_0_var(--foreground)] transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
            onClick={() => fileInput.current?.click()}
            disabled={busy !== null}
          >
            browse files
          </button>
          <span className="text-muted">
            or put them in{" "}
            <code className="bg-surface px-1">{library?.folders.sources ?? "data/sources"}</code>{" "}
            yourself
          </span>
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          accept={(library?.supportedExtensions ?? []).join(",")}
          onChange={(e) => {
            if (e.target.files) upload(e.target.files, "sources");
            e.target.value = "";
          }}
        />
      </div>

      {error && (
        <p className="border-2 border-dropped-ink bg-dropped p-3 text-xs font-bold text-dropped-ink">
          {error}
        </p>
      )}

      {/* file library */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wide">
            Your documents{" "}
            <span className="font-normal text-muted">
              ({files.length} file{files.length === 1 ? "" : "s"}
              {pending.length > 0 ? `, ${pending.length} not yet in memory` : ""})
            </span>
          </h3>
          <div className="flex items-center gap-3 text-xs">
            {chosen.length > 0 && (
              <button
                className="border-2 border-foreground bg-background px-4 py-1 font-bold disabled:opacity-40"
                disabled={busy !== null}
                onClick={() => absorb(chosen)}
              >
                {busy === "absorb" ? "reading…" : `absorb ${chosen.length} selected`}
              </button>
            )}
            {pending.length > 0 && chosen.length === 0 && (
              <button
                className="border-2 border-foreground bg-background px-4 py-1 font-bold disabled:opacity-40"
                disabled={busy !== null}
                onClick={() => absorb(pending)}
              >
                {busy === "absorb" ? "reading…" : `absorb all ${pending.length} new`}
              </button>
            )}
            <button className="underline underline-offset-4 text-muted" onClick={load}>
              refresh
            </button>
          </div>
        </div>

        {files.length === 0 ? (
          <p className="border border-dashed border-line p-6 text-center text-sm text-muted">
            No documents yet. Drop files above — that&apos;s the fastest way to
            build memory.
          </p>
        ) : (
          <ul className="flex flex-col">
            {files.map((f) => {
              const k = key(f);
              const isSelected = selected.has(k);
              return (
                <li
                  key={k}
                  className={`flex flex-wrap items-center gap-3 border-b border-line px-2 py-2 text-xs ${
                    isSelected ? "bg-added" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={!f.supported}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(k);
                      else next.delete(k);
                      setSelected(next);
                    }}
                  />
                  <span className="min-w-40 flex-1 font-bold">{f.name}</span>
                  <span className="w-16 text-muted">{f.kind}</span>
                  <span className="w-16 text-muted">{fmtBytes(f.bytes)}</span>
                  {f.bucket === "resumes" && (
                    <span className="border border-line px-1 text-[10px] text-muted">
                      base resume
                    </span>
                  )}
                  <span className={`px-1.5 py-0.5 text-[10px] uppercase ${STATUS_STYLE[f.status]}`}>
                    {f.supported ? STATUS_LABEL[f.status] : "unsupported"}
                  </span>
                  {f.absorbed && (
                    <span className="text-[10px] text-muted">
                      {f.absorbed.facts} facts · {f.absorbed.absorbedAt.slice(0, 10)}
                    </span>
                  )}
                  <button
                    className="text-muted underline underline-offset-4 hover:text-foreground disabled:opacity-40"
                    disabled={busy !== null || !f.supported}
                    onClick={() => absorb([f])}
                  >
                    absorb
                  </button>
                  <button
                    className="text-muted hover:text-dropped-ink"
                    disabled={busy !== null}
                    onClick={() => remove(f)}
                    title="delete file (memory already absorbed is kept)"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="text-[11px] leading-4 text-muted">
          Absorbing is additive and safe to repeat — identical facts are
          deduplicated by content hash, so re-absorbing a changed file adds only
          what&apos;s new. Deleting a file here does not remove what it already
          taught memory.
        </p>
      </div>

      {/* per-file results */}
      {results.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wide">What was learned</h3>
          <ul className="flex flex-col gap-2 text-xs">
            {results.map((r, i) => (
              <li
                key={i}
                className={`border-l-2 pl-2 ${r.ok ? "border-added-ink" : "border-dropped-ink"}`}
              >
                <span className="font-bold">{r.file}</span>
                {r.ok ? (
                  <>
                    <span className="ml-2 text-muted">
                      +{r.addedEntities} entities · +{r.addedFacts} facts · +{r.addedItems} items
                    </span>
                    {r.summary && <p className="mt-0.5 leading-5 text-muted">{r.summary}</p>}
                    {r.warning && (
                      <p className="mt-0.5 leading-5 text-rewritten-ink">⚠ {r.warning}</p>
                    )}
                  </>
                ) : (
                  <p className="mt-0.5 leading-5 text-dropped-ink">{r.error}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* text entry — secondary */}
      <div className="border-t border-line pt-4">
        <button
          className="text-xs underline underline-offset-4"
          onClick={() => setShowText((v) => !v)}
        >
          {showText ? "hide" : "or type something instead"} {showText ? "▾" : "▸"}
        </button>
        {showText && (
          <div className="mt-3 flex flex-col gap-2">
            <textarea
              className="min-h-40 w-full border border-line bg-white p-3 font-mono text-xs leading-5 focus:border-foreground focus:outline-none"
              placeholder="Anything not already in a file — a number you just remembered, context about a project, what you want out of your next role."
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted">label</span>
              <input
                className="w-32 border border-line bg-white px-2 py-1 font-mono focus:border-foreground focus:outline-none"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
              <button
                className="border border-foreground px-4 py-1 font-bold disabled:opacity-40"
                disabled={busy !== null || !text.trim()}
                onClick={async () => {
                  setBusy("text");
                  setError(null);
                  try {
                    const res = await fetch("/api/intake", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ text, label }),
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error ?? "Failed");
                    setResults([
                      {
                        ok: true,
                        file: label,
                        addedEntities: data.addedEntities,
                        addedFacts: data.addedFacts,
                        addedItems: data.addedItems,
                        summary: data.summary,
                      },
                    ]);
                    setText("");
                    onIngested();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Failed");
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {busy === "text" ? "reading…" : "add to memory"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
