"use client";

import { useEffect, useState } from "react";

// Center panel (plan §7): pick a resume from data/resumes/, optionally paste
// a job description, and run. The dropdown value is a KEY resolved against a
// server-side allowlist — never a path (plan §10.1).
//
// The pipeline itself (analyze → interview → rewrite) is Phase 3; this panel
// currently establishes the selection + JD flow it will hang off of.

export default function RunPanel() {
  const [resumes, setResumes] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [jd, setJd] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/resumes")
      .then((r) => r.json())
      .then((d) => {
        setResumes(d.resumes ?? []);
        if (d.resumes?.length) setSelected(d.resumes[0]);
      })
      .catch(() => setLoadError("Could not list data/resumes/"));
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-500">
          Resume (from <code>data/resumes/</code>)
        </label>
        {resumes.length > 0 ? (
          <select
            className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-900"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {resumes.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : (
          <p className="rounded border border-dashed border-zinc-300 p-3 text-sm text-zinc-500 dark:border-zinc-600">
            {loadError ??
              "No .docx files found. Drop your resumes into data/resumes/ — the folder is the variant list."}
          </p>
        )}
      </div>

      <div className="flex flex-1 flex-col">
        <label className="mb-1 block text-xs font-medium text-zinc-500">
          Job description (optional)
        </label>
        <textarea
          className="min-h-40 flex-1 rounded border border-zinc-300 p-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
          placeholder="Paste the posting here to get the recruiter-screen report (keywords, title alignment). Leave empty for a bullet audit only."
          value={jd}
          onChange={(e) => setJd(e.target.value)}
        />
      </div>

      <button
        className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        disabled={!selected}
        onClick={() => alert("Pipeline lands in Phase 3 — parse, analyze, interview, rewrite.")}
      >
        Run
      </button>
    </div>
  );
}
