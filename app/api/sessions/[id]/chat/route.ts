// POST /api/sessions/[id]/chat — conversational editing of the document.

import { editDoc } from "@/lib/ai/pipeline";
import type { Session } from "@/lib/ai/session";
import { loadSession } from "@/lib/memory/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await loadSession<Session>(id);
    if (!session) return Response.json({ error: "Session not found" }, { status: 404 });

    const body = await request.json();
    if (typeof body.message !== "string" || !body.message.trim()) {
      return Response.json({ error: "Empty message" }, { status: 400 });
    }
    return Response.json(await editDoc(session, body.message.trim()));
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Edit failed" },
      { status: 500 }
    );
  }
}
