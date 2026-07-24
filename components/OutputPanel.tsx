"use client";

// Right panel (plan §7): the deliverable — final bullets as plain text with
// char counts and copy buttons, plus the run-scoped chat. Populated in
// Phase 3/4; the empty state documents the contract until then.

export default function OutputPanel() {
  return (
    <div className="flex h-full flex-col justify-between">
      <p className="text-sm text-zinc-500">
        Output appears here after a run: every bullet as plain text with a char
        count, copy buttons, and a chat box to iterate. You paste the results
        into Word yourself — this app never edits your .docx files.
      </p>
    </div>
  );
}
