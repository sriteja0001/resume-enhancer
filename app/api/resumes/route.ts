// GET /api/resumes — filenames in data/resumes/. This listing doubles as the
// server-side allowlist: the UI sends back a name, never a path.

import { listResumes } from "@/lib/memory/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ resumes: await listResumes() });
}
