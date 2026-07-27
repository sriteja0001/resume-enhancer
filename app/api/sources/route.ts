// GET  /api/sources — every source document with its absorb status.
// POST /api/sources — upload files (multipart). This is the primary way
//                     documents get in; you never need to know the folder.
// DELETE /api/sources?name=..&bucket=.. — remove a file.

import {
  RESUMES_DIR_LABEL,
  SOURCES_DIR_LABEL,
  deleteSourceFile,
  listSourceFiles,
  loadLedger,
  saveSourceUpload,
  statusOf,
  type Bucket,
} from "@/lib/memory/store";
import { SUPPORTED_EXTENSIONS, isSupported, kindOf } from "@/lib/sources/extract";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BYTES = 25 * 1024 * 1024;

function asBucket(v: unknown): Bucket {
  return v === "resumes" ? "resumes" : "sources";
}

async function payload() {
  const [files, ledger] = await Promise.all([listSourceFiles(), loadLedger()]);
  return {
    files: files.map((f) => ({
      ...f,
      kind: kindOf(f.name),
      supported: isSupported(f.name),
      status: statusOf(f, ledger),
      absorbed: ledger[`${f.bucket}/${f.name}`] ?? null,
    })),
    supportedExtensions: SUPPORTED_EXTENSIONS,
    folders: { sources: SOURCES_DIR_LABEL, resumes: RESUMES_DIR_LABEL },
  };
}

export async function GET() {
  return Response.json(await payload());
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const bucket = asBucket(form.get("bucket"));
    const uploads = form.getAll("files").filter((v): v is File => v instanceof File);

    if (uploads.length === 0) {
      return Response.json({ error: "No files received" }, { status: 400 });
    }

    const saved: string[] = [];
    const rejected: { name: string; reason: string }[] = [];

    for (const file of uploads) {
      if (!isSupported(file.name)) {
        rejected.push({
          name: file.name,
          reason: `unsupported type — use ${SUPPORTED_EXTENSIONS.join(", ")}`,
        });
        continue;
      }
      if (file.size > MAX_BYTES) {
        rejected.push({ name: file.name, reason: "larger than 25 MB" });
        continue;
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      // A .docx dropped into the resumes bucket becomes a tailoring base;
      // everything else is just knowledge.
      saved.push(await saveSourceUpload(file.name, buffer, bucket));
    }

    return Response.json({ saved, rejected, ...(await payload()) });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const name = url.searchParams.get("name");
  const bucket = asBucket(url.searchParams.get("bucket"));
  if (!name) return Response.json({ error: "Missing name" }, { status: 400 });

  const ok = await deleteSourceFile(name, bucket);
  if (!ok) return Response.json({ error: "File not found" }, { status: 404 });
  return Response.json(await payload());
}
