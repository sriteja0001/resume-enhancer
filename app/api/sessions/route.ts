// GET /api/sessions — session history, newest first.

import { listSessions, loadSession } from "@/lib/memory/store";
import type { Session } from "@/lib/ai/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const ids = await listSessions();
  const sessions = [];
  for (const id of ids) {
    const s = await loadSession<Session>(id);
    if (s) {
      sessions.push({
        id: s.id,
        createdAt: s.createdAt,
        resumeFile: s.resumeFile,
        roleTitle: s.target?.roleTitle ?? "(untitled role)",
        demo: s.demo,
      });
    }
  }
  return Response.json({ sessions });
}
