// POST /api/sessions/[id]/export — generate a .docx of the tailored resume.
//
// This writes a NEW file into data/exports/ and streams it back for download.
// The resume you uploaded is opened read-only and never modified.

import { docToDocx, exportFilename } from "@/lib/resume/docx-export";
import type { Session } from "@/lib/ai/session";
import { loadSession, saveSession, writeExport } from "@/lib/memory/store";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await loadSession<Session>(id);
    if (!session) return Response.json({ error: "Session not found" }, { status: 404 });

    const buffer = await docToDocx(session.tailored);
    const filename = exportFilename(session.resumeFile, session.target?.roleTitle ?? null);
    const savedPath = await writeExport(filename, buffer);

    session.exportedPath = savedPath;
    await saveSession(session.id, session);

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
        "X-Saved-Path": savedPath,
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Export failed" },
      { status: 500 }
    );
  }
}
