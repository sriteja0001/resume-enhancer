// GET /api/sessions/[id] — reopen a tailoring session.

import { loadSession } from "@/lib/memory/store";
import type { Session } from "@/lib/ai/session";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await loadSession<Session>(id);
  if (!session) return Response.json({ error: "Session not found" }, { status: 404 });
  return Response.json(session);
}
