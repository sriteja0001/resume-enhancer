// GET  /api/calibration — bullets the candidate has judged.
// POST /api/calibration — record a judgment { text, verdict, note? }.
//
// This is the strongest ground truth available: the candidate knows which of
// their accomplishments are genuinely impressive, and the model is guessing.
// Ratings anchor the critic's scale and are also the labels the eval harness
// checks the critic against.

import { addCalibration, loadCalibration } from "@/lib/memory/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ examples: await loadCalibration() });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const verdict = body.verdict === "strong" || body.verdict === "weak" ? body.verdict : null;

    if (!text || !verdict) {
      return Response.json(
        { error: 'Need { text, verdict: "strong" | "weak" }' },
        { status: 400 }
      );
    }
    const examples = await addCalibration({
      text,
      verdict,
      note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : null,
      ratedAt: new Date().toISOString(),
    });
    return Response.json({ examples });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
