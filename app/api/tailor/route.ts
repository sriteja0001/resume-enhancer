// POST /api/tailor — Enhance mode. Resume + posting → tailored session.

import { clampRounds } from "@/lib/ai/critic";
import { tailor } from "@/lib/ai/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (typeof body.resume !== "string" || !body.resume) {
      return Response.json({ error: "Missing resume" }, { status: 400 });
    }
    if (typeof body.jobDescription !== "string" || !body.jobDescription.trim()) {
      return Response.json({ error: "Paste the job posting first" }, { status: 400 });
    }
    const session = await tailor({
      resumeName: body.resume,
      jobDescription: body.jobDescription.trim(),
      charLimit: Number(body.charLimit) || 200,
      notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null,
      reviewRounds: clampRounds(body.reviewRounds),
    });
    return Response.json(session);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Tailoring failed" },
      { status: 500 }
    );
  }
}
