"use client";

import { useState } from "react";
import type { Session } from "@/lib/ai/session";

// The critic loop's working, shown rather than hidden. Two reasons: the critic
// shares a model with the generator, so its judgment is worth seeing rather
// than trusting blindly — and a revision that was proposed and then rejected
// tells you as much about the resume as one that was kept.

function ScoreBar({ label, value }: { label: string; value: number }) {
  const tone =
    value >= 8 ? "bg-added" : value >= 5 ? "bg-rewritten" : "bg-dropped";
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-28 shrink-0 text-[10px] text-muted">{label}</span>
      <span className="h-1.5 w-16 shrink-0 border border-line">
        <span className={`block h-full ${tone}`} style={{ width: `${value * 10}%` }} />
      </span>
      <span className="w-6 text-[10px] tabular-nums">{value}</span>
    </div>
  );
}

export default function CritiqueTrace({ session }: { session: Session }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const rounds = session.critique ?? [];
  if (rounds.length === 0) return null;

  const first = rounds[0].score;
  const last = rounds[rounds.length - 1].score;

  return (
    <div className="flex flex-col gap-2 border border-line bg-surface p-4">
      <button
        className="flex flex-wrap items-baseline justify-between gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <h3 className="text-xs font-bold uppercase tracking-wide">
          Reviewer trace {open ? "▾" : "▸"}
        </h3>
        <span className="text-[11px] text-muted">
          {rounds.length} round{rounds.length === 1 ? "" : "s"} ·{" "}
          {last > first ? (
            <span className="font-bold text-added-ink">
              {first}/10 → {last}/10
            </span>
          ) : (
            <span>scored {last}/10</span>
          )}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-4">
          <p className="text-[11px] leading-5 text-muted">
            A reviewer scores every bullet through four separate lenses, then has
            to name the artifact, name the outcome, and write the question an
            interviewer would ask. Revisions are only kept if they win a blind
            comparison against the previous version — the reviewer is not told
            which is which.
          </p>

          {rounds.map((r) => (
            <div key={r.round} className="border-l-2 border-line pl-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-xs font-bold">Round {r.round}</span>
                <span
                  className={`px-1.5 text-[10px] font-bold ${
                    r.score >= 8
                      ? "bg-added text-added-ink"
                      : r.score >= 5
                        ? "bg-rewritten text-rewritten-ink"
                        : "bg-dropped text-dropped-ink"
                  }`}
                >
                  {r.score}/10
                </span>
                {r.accepted === true && (
                  <span className="bg-added px-1.5 text-[10px] text-added-ink">
                    revision kept
                  </span>
                )}
                {r.accepted === false && (
                  <span className="bg-dropped px-1.5 text-[10px] text-dropped-ink">
                    revision rejected
                  </span>
                )}
              </div>

              <p className="mt-1 text-xs leading-5">{r.verdict}</p>
              <p className="mt-1 text-[11px] leading-4 text-muted">
                <span className="font-bold">Weakest link:</span> {r.weakestLink}
              </p>
              {r.note && (
                <p className="mt-1 text-[11px] leading-4 text-muted">{r.note}</p>
              )}

              {r.revised.length > 0 && (
                <div className="mt-2 flex flex-col gap-1.5">
                  {r.revised.map((c) => (
                    <div key={c.id} className="text-[11px] leading-4">
                      <p className="text-muted line-through">{c.before}</p>
                      <p>{c.after}</p>
                    </div>
                  ))}
                </div>
              )}

              <button
                className="mt-2 text-[11px] underline underline-offset-4 text-muted"
                onClick={() => setExpanded(expanded === r.round ? null : r.round)}
              >
                {expanded === r.round ? "hide" : "per-bullet scores"}
              </button>

              {expanded === r.round && (
                <ul className="mt-2 flex flex-col gap-3">
                  {r.bulletScores.map((b) => (
                    <li key={b.id} className="border-l border-line pl-2">
                      <div className="flex flex-col gap-0.5">
                        <ScoreBar label="ATS screen" value={b.lenses.atsScreen} />
                        <ScoreBar label="6-second skim" value={b.lenses.sixSecondSkim} />
                        <ScoreBar label="domain expert" value={b.lenses.domainExpert} />
                        <ScoreBar label="interview defense" value={b.lenses.interviewDefense} />
                      </div>
                      <p className="mt-1 text-[11px] leading-4 text-muted">
                        <span className="font-bold">artifact:</span>{" "}
                        {b.namedArtifact ?? (
                          <span className="text-dropped-ink">none identifiable</span>
                        )}{" "}
                        · <span className="font-bold">outcome:</span>{" "}
                        {b.namedOutcome ?? (
                          <span className="text-dropped-ink">none stated</span>
                        )}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-4 text-muted">
                        <span className="font-bold">an interviewer would ask:</span>{" "}
                        {b.interviewerFollowUp}
                      </p>
                      {b.instruction && (
                        <p className="mt-0.5 text-[11px] leading-4">
                          <span className="font-bold">asked for:</span> {b.instruction}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
