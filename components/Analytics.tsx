"use client";

import { useState } from "react";
import type { Session } from "@/lib/ai/session";
import { changeLog, countChanges } from "@/lib/resume/model";

// The analytical half of the product: what the posting asks for, what your
// history can actually evidence, and every decision the enhancer made with
// its reason attached. A truthful gap is more useful than a fake green row.

const STATUS_STYLE: Record<string, string> = {
  strong: "bg-added text-added-ink",
  partial: "bg-rewritten text-rewritten-ink",
  none: "bg-dropped text-dropped-ink",
};

const IMPORTANCE_ORDER = { critical: 0, important: 1, "nice-to-have": 2 } as const;

export function TargetCard({ session }: { session: Session }) {
  const t = session.target;
  if (!t) return null;
  const chip = (label: string, value: string) => (
    <span className="border border-line bg-background px-2 py-0.5">
      <span className="text-muted">{label} </span>
      {value}
    </span>
  );
  return (
    <div className="flex flex-col gap-2 border border-line bg-surface p-4 text-xs">
      <div className="flex flex-wrap gap-2">
        {chip("role", t.roleTitle)}
        {chip("family", t.roleFamily)}
        {chip("level", t.seniority)}
        {chip("company", t.companyType)}
      </div>
      {t.domains.length > 0 && (
        <p>
          <span className="text-muted">domains </span>
          {t.domains.map((d) => (
            <span key={d} className="mr-1 bg-moved px-1 text-moved-ink">
              {d}
            </span>
          ))}
        </p>
      )}
      <p className="leading-5 text-muted">{t.readStrategy}</p>
    </div>
  );
}

export function CoverageMatrix({ session }: { session: Session }) {
  const rows = [...session.coverage].sort(
    (a, b) =>
      (IMPORTANCE_ORDER[a.importance] ?? 3) - (IMPORTANCE_ORDER[b.importance] ?? 3)
  );
  if (rows.length === 0) return null;

  const gaps = rows.filter((r) => r.status === "none");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wide">Requirement coverage</h3>
        <span className="text-[11px] text-muted">
          {rows.filter((r) => r.status === "strong").length} strong ·{" "}
          {rows.filter((r) => r.status === "partial").length} partial · {gaps.length} gaps
        </span>
      </div>
      <table className="w-full border-collapse text-xs">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line align-top">
              <td className="w-20 py-1.5 pr-2">
                <span className={`px-1.5 py-0.5 text-[10px] uppercase ${STATUS_STYLE[r.status]}`}>
                  {r.status}
                </span>
              </td>
              <td className="py-1.5 pr-2">
                {r.requirement}
                <span className="ml-1 text-[10px] text-muted">({r.importance})</span>
                {r.note && <p className="mt-0.5 text-[11px] leading-4 text-muted">{r.note}</p>}
              </td>
              <td className="w-16 py-1.5 text-right text-[10px] text-muted">
                {r.evidenceFactIds.length > 0
                  ? `${r.evidenceFactIds.length} facts`
                  : r.status === "none"
                    ? "no evidence"
                    : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {gaps.length > 0 && (
        <p className="border border-dashed border-dropped-ink p-2 text-[11px] leading-5">
          <span className="font-bold">Honest gaps.</span> Nothing in your memory
          evidences {gaps.length} requirement{gaps.length === 1 ? "" : "s"}. These were
          deliberately not faked — address them in a cover letter, or go build the
          evidence and add it in Intake mode.
        </p>
      )}
    </div>
  );
}

export function ChangeLog({ session }: { session: Session }) {
  const [open, setOpen] = useState(true);
  const rows = changeLog(session.tailored);
  const counts = countChanges(session.tailored);

  return (
    <div className="flex flex-col gap-2">
      <button
        className="flex items-baseline justify-between text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <h3 className="text-xs font-bold uppercase tracking-wide">
          Change log {open ? "▾" : "▸"}
        </h3>
        <span className="text-[11px] text-muted">
          {counts.kept} kept · {counts.rewritten} rewritten · {counts.added} added ·{" "}
          {counts.moved} moved · {counts.dropped} dropped
        </span>
      </button>

      {open && (
        <ul className="flex flex-col gap-2 text-xs">
          {rows.length === 0 && (
            <li className="text-muted">
              Nothing changed — the tailored version is identical to your original.
            </li>
          )}
          {rows.map((r, i) => (
            <li key={i} className="border-l-2 border-line pl-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <span
                  className={`px-1 text-[10px] uppercase ${
                    r.origin === "dropped"
                      ? "bg-dropped text-dropped-ink"
                      : r.origin === "added"
                        ? "bg-added text-added-ink"
                        : r.origin === "moved"
                          ? "bg-moved text-moved-ink"
                          : "bg-rewritten text-rewritten-ink"
                  }`}
                >
                  {r.origin}
                </span>
                <span className="text-[10px] text-muted">
                  {r.section} · {r.entry}
                </span>
              </div>
              <p className="mt-0.5 leading-5">{r.text}</p>
              {r.originalText && (
                <p className="mt-0.5 text-[11px] leading-4 text-muted line-through">
                  {r.originalText}
                </p>
              )}
              {r.why && <p className="mt-0.5 text-[11px] leading-4 text-muted">↳ {r.why}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Flags a tailored document whose section structure does not match the source
 * resume. Catches two things at once: a stale session produced before section
 * preservation existed, and any future regression that starts renaming or
 * reordering sections again.
 */
export function StructureWarning({ session }: { session: Session }) {
  const before = session.original.sections.map((s) => s.title);
  const after = session.tailored.sections.map((s) => s.title);
  const norm = (v: string[]) => v.map((t) => t.trim().toLowerCase());

  const renamed = norm(after).filter((t) => !norm(before).includes(t));
  const missing = norm(before).filter((t) => !norm(after).includes(t));
  const reordered =
    renamed.length === 0 &&
    missing.length === 0 &&
    norm(after).join("|") !== norm(before).join("|");

  if (renamed.length === 0 && missing.length === 0 && !reordered) return null;

  return (
    <div className="border-2 border-rewritten-ink bg-rewritten p-3 text-xs text-rewritten-ink">
      <p className="font-bold">
        This resume&apos;s section structure differs from your original.
      </p>
      <ul className="mt-1 flex flex-col gap-0.5">
        {renamed.length > 0 && (
          <li>
            headings not in your resume: {renamed.join(", ")}
          </li>
        )}
        {missing.length > 0 && <li>your headings that are gone: {missing.join(", ")}</li>}
        {reordered && <li>your sections were reordered</li>}
      </ul>
      <p className="mt-1 opacity-80">
        Sections are supposed to be preserved exactly. If this is an older
        session, re-run the tailoring — results generated before that rule
        existed are kept as they were rather than silently rewritten.
      </p>
    </div>
  );
}

export function AuditWarnings({ session }: { session: Session }) {
  if (session.auditFailures.length === 0) return null;
  return (
    <div className="border-2 border-dropped-ink bg-dropped p-3 text-xs text-dropped-ink">
      <p className="font-bold">
        {session.auditFailures.length} item{session.auditFailures.length === 1 ? "" : "s"} failed
        the number audit and are flagged in the document.
      </p>
      <ul className="mt-1 flex flex-col gap-1">
        {session.auditFailures.map((f, i) => (
          <li key={i}>
            <span className="opacity-70">{f.where}:</span> {f.issues.join("; ")}
          </li>
        ))}
      </ul>
      <p className="mt-1 opacity-80">
        Numbers must trace to a fact in your memory or to the original resume. Fix them in
        chat, or add the missing fact in Intake mode.
      </p>
    </div>
  );
}
