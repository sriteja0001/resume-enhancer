// GET  /api/memory — the raw master.md plus its parsed view and stats.
// PUT  /api/memory — overwrite master.md with hand-edited markdown.

import { memoryStats } from "@/lib/memory/graph";
import { parseMemory } from "@/lib/memory/markdown";
import { readMasterMarkdown, writeMasterMarkdown } from "@/lib/memory/store";
import { isDemo } from "@/lib/ai/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const markdown = await readMasterMarkdown();
  const memory = parseMemory(markdown);
  return Response.json({
    markdown,
    memory,
    stats: memoryStats(memory),
    demo: isDemo(),
  });
}

export async function PUT(request: Request) {
  const body = await request.json();
  if (typeof body.markdown !== "string") {
    return Response.json({ error: "Expected { markdown: string }" }, { status: 400 });
  }
  await writeMasterMarkdown(body.markdown);
  const memory = parseMemory(body.markdown);
  return Response.json({
    markdown: body.markdown,
    memory,
    stats: memoryStats(memory),
    demo: isDemo(),
  });
}
