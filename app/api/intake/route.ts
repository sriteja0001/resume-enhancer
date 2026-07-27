// POST /api/intake — Intake mode. Push text (or a whole resume) into memory.
// Body: { text, label } or { resume } to ingest a file from data/resumes/.

import { ingest, ingestResume } from "@/lib/ai/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (typeof body.resume === "string" && body.resume) {
      return Response.json(await ingestResume(body.resume));
    }
    if (typeof body.text === "string" && body.text.trim()) {
      return Response.json(
        await ingest({
          text: body.text.trim(),
          sourceLabel: typeof body.label === "string" && body.label ? body.label : "intake",
        })
      );
    }
    return Response.json({ error: "Provide text or a resume filename" }, { status: 400 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Intake failed" },
      { status: 500 }
    );
  }
}
