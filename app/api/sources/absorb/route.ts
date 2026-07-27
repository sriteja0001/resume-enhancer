// POST /api/sources/absorb — read one or more source documents into memory.
// Body: { files: [{ name, bucket }] }. Files are processed in order; one
// failure doesn't abort the rest, it's reported per file.

import { absorbFile } from "@/lib/ai/pipeline";
import type { Bucket } from "@/lib/memory/store";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const requested: { name: string; bucket: Bucket }[] = Array.isArray(body.files)
      ? body.files
      : [];
    if (requested.length === 0) {
      return Response.json({ error: "No files selected" }, { status: 400 });
    }

    const results = [];
    for (const { name, bucket } of requested) {
      try {
        results.push({ ok: true as const, ...(await absorbFile({ name, bucket })) });
      } catch (err) {
        results.push({
          ok: false as const,
          file: name,
          error: err instanceof Error ? err.message : "Failed",
        });
      }
    }

    const succeeded = results.filter((r) => r.ok);
    return Response.json({
      results,
      totals: {
        files: succeeded.length,
        failed: results.length - succeeded.length,
        entities: succeeded.reduce((n, r) => n + (r.ok ? r.addedEntities : 0), 0),
        facts: succeeded.reduce((n, r) => n + (r.ok ? r.addedFacts : 0), 0),
        items: succeeded.reduce((n, r) => n + (r.ok ? r.addedItems : 0), 0),
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Absorb failed" },
      { status: 500 }
    );
  }
}
