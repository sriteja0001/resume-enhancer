"use client";

import { useState } from "react";
import { wordDiff } from "@/lib/resume/diff";
import type { Bullet, InlineValue, Origin, ResumeDoc } from "@/lib/resume/model";

// The rendering of the tailored resume. The rule the whole product hangs on:
// BLACK = this survived from your original file untouched. Anything tinted was
// changed, added, or moved, and hovering it explains why.

const TINT: Record<Exclude<Origin, "kept">, string> = {
  rewritten: "bg-rewritten text-rewritten-ink",
  added: "bg-added text-added-ink",
  moved: "bg-moved text-moved-ink",
  reordered: "bg-moved text-moved-ink",
};

export function OriginLegend() {
  const swatch = (cls: string, label: string) => (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-3 w-3 border border-line ${cls}`} />
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
      {swatch("bg-paper", "unchanged")}
      {swatch("bg-rewritten", "rewritten")}
      {swatch("bg-added", "added")}
      {swatch("bg-moved", "moved / reordered")}
      {swatch("bg-dropped", "dropped")}
    </div>
  );
}

function BulletLine({ bullet, showDiff }: { bullet: Bullet; showDiff: boolean }) {
  const failed = bullet.why?.startsWith("⚠");
  const tint = bullet.origin === "kept" ? "" : TINT[bullet.origin];

  const body =
    showDiff && bullet.origin === "rewritten" && bullet.originalText ? (
      <>
        {wordDiff(bullet.originalText, bullet.text).map((part, i) =>
          part.kind === "removed" ? (
            <span key={i} className="text-dropped-ink line-through opacity-60">
              {part.text}
            </span>
          ) : part.kind === "added" ? (
            <span key={i} className="bg-added text-added-ink">
              {part.text}
            </span>
          ) : (
            <span key={i}>{part.text}</span>
          )
        )}
      </>
    ) : (
      bullet.text
    );

  return (
    <li
      className={`ml-4 list-disc pl-1 ${failed ? "outline outline-2 outline-dropped-ink" : ""}`}
      title={bullet.why ?? undefined}
    >
      <mark className={tint}>{body}</mark>
      {bullet.origin !== "kept" && bullet.why && !failed && (
        <span className="ml-1 cursor-help text-[10px] text-muted" title={bullet.why}>
          ⓘ
        </span>
      )}
      {failed && (
        <span className="ml-1 text-[10px] font-bold text-dropped-ink">{bullet.why}</span>
      )}
    </li>
  );
}

function InlineValues({ values }: { values: InlineValue[] }) {
  return (
    <>
      {values.map((v, i) => (
        <span key={i}>
          <mark
            className={v.origin === "kept" ? "" : TINT[v.origin]}
            title={v.why ?? undefined}
          >
            {v.text}
          </mark>
          {i < values.length - 1 ? ", " : ""}
        </span>
      ))}
    </>
  );
}

interface Props {
  doc: ResumeDoc;
}

export default function ResumeMockup({ doc }: Props) {
  const [showDiff, setShowDiff] = useState(true);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <OriginLegend />
        <label className="flex items-center gap-1.5 text-[11px] text-muted">
          <input
            type="checkbox"
            checked={showDiff}
            onChange={(e) => setShowDiff(e.target.checked)}
          />
          show word-level changes
        </label>
      </div>

      <article className="paper border border-line p-8 text-[13px] shadow-[3px_3px_0_0_var(--line)]">
        {doc.header.name && (
          <h1 className="text-center text-xl font-bold tracking-wide">{doc.header.name}</h1>
        )}
        {doc.header.contactLine && (
          <p className="mb-4 text-center text-[11px] text-muted">{doc.header.contactLine}</p>
        )}

        {doc.sections.map((section) => (
          <section key={section.id} className="mb-4">
            <h2
              className="mb-1 border-b border-foreground pb-0.5 text-[11px] font-bold uppercase tracking-widest"
              title={section.why ?? undefined}
            >
              {section.title}
            </h2>

            {section.entries.map((entry) => (
              <div key={entry.id} className="mb-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-bold">
                    <mark className={entry.origin === "kept" ? "" : TINT[entry.origin]}>
                      {entry.org ?? ""}
                    </mark>
                    {entry.origin === "moved" && entry.movedFrom && (
                      <span
                        className="ml-2 rounded-sm bg-moved px-1 py-px align-middle text-[9px] font-normal uppercase tracking-wide text-moved-ink"
                        title={entry.why ?? undefined}
                      >
                        moved from {entry.movedFrom}
                      </span>
                    )}
                  </span>
                  {entry.location && (
                    <span className="shrink-0 text-[11px]">{entry.location}</span>
                  )}
                </div>

                {(entry.role || entry.dates) && (
                  <div className="flex items-baseline justify-between gap-3 italic">
                    <span>{entry.role}</span>
                    {entry.dates && (
                      <span className="shrink-0 not-italic text-[11px]">{entry.dates}</span>
                    )}
                  </div>
                )}

                {entry.inlineLists.map((list, i) => (
                  <p key={i} className="mt-0.5">
                    <span className="font-bold">{list.label}: </span>
                    <InlineValues values={list.values} />
                    {list.dropped.length > 0 && (
                      <span className="ml-2 text-[10px]">
                        {list.dropped.map((d, j) => (
                          <span
                            key={j}
                            className="mr-1 bg-dropped px-1 text-dropped-ink line-through"
                            title={d.why}
                          >
                            {d.text}
                          </span>
                        ))}
                      </span>
                    )}
                  </p>
                ))}

                {entry.bullets.length > 0 && (
                  <ul className="mt-0.5">
                    {entry.bullets.map((b) => (
                      <BulletLine key={b.id} bullet={b} showDiff={showDiff} />
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </section>
        ))}
      </article>
    </div>
  );
}
