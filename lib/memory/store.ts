// Storage seam: the only module allowed to touch the filesystem. Layout:
//
//   data/memory/master.md    the knowledge base (source of truth)
//   data/memory/sources.json ledger of which files have been absorbed
//   data/sources/*           documents you feed the knowledge base
//   data/resumes/*.docx      base resumes you tailor from, read-only
//   data/exports/*.docx      resumes this app generates (new files only)
//   data/sessions/*.json     tailoring sessions (mockup + chat + rationale)

import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { CalibrationExample } from "../ai/session";
import { parseMemory, serializeMemory } from "./markdown";
import type { Entity, Memory } from "./types";
import { EMPTY_MEMORY } from "./types";

export type { CalibrationExample };

const DATA_DIR = path.join(process.cwd(), "data");
const MEMORY_DIR = path.join(DATA_DIR, "memory");
const MASTER_PATH = path.join(MEMORY_DIR, "master.md");
const LEDGER_PATH = path.join(MEMORY_DIR, "sources.json");
const CALIBRATION_PATH = path.join(MEMORY_DIR, "calibration.json");
const SOURCES_DIR = path.join(DATA_DIR, "sources");
const RESUMES_DIR = path.join(DATA_DIR, "resumes");
const EXPORTS_DIR = path.join(DATA_DIR, "exports");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");

export const SOURCES_DIR_LABEL = "data/sources";
export const RESUMES_DIR_LABEL = "data/resumes";

async function ensureDirs(): Promise<void> {
  await fs.mkdir(MEMORY_DIR, { recursive: true });
  await fs.mkdir(SOURCES_DIR, { recursive: true });
  await fs.mkdir(RESUMES_DIR, { recursive: true });
  await fs.mkdir(EXPORTS_DIR, { recursive: true });
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
}

export async function readMasterMarkdown(): Promise<string> {
  await ensureDirs();
  try {
    return await fs.readFile(MASTER_PATH, "utf-8");
  } catch {
    const seeded = serializeMemory(EMPTY_MEMORY);
    await fs.writeFile(MASTER_PATH, seeded, "utf-8");
    return seeded;
  }
}

export async function writeMasterMarkdown(markdown: string): Promise<void> {
  await ensureDirs();
  await fs.writeFile(MASTER_PATH, markdown, "utf-8");
}

export async function loadMemory(): Promise<Memory> {
  return parseMemory(await readMasterMarkdown());
}

export async function saveMemory(memory: Memory): Promise<void> {
  await writeMasterMarkdown(serializeMemory(memory));
}

/**
 * Merge newly-extracted entities into memory. Append-only in spirit: an
 * existing entity gains new facts and items but never loses any, and nothing
 * is overwritten silently. Matching is by id, then by normalized title/org.
 */
export function mergeEntities(memory: Memory, incoming: Entity[]): {
  memory: Memory;
  addedEntities: number;
  addedFacts: number;
  addedItems: number;
} {
  const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
  let addedEntities = 0;
  let addedFacts = 0;
  let addedItems = 0;

  for (const incomingEntity of incoming) {
    const existing =
      memory.entities.find((e) => e.id === incomingEntity.id) ??
      memory.entities.find(
        (e) =>
          norm(e.title) === norm(incomingEntity.title) ||
          (norm(e.org) !== "" && norm(e.org) === norm(incomingEntity.org))
      );

    if (!existing) {
      memory.entities.push(incomingEntity);
      addedEntities += 1;
      addedFacts += incomingEntity.facts.length;
      addedItems += incomingEntity.items.length;
      continue;
    }

    existing.org ??= incomingEntity.org;
    existing.role ??= incomingEntity.role;
    existing.dates ??= incomingEntity.dates;
    existing.location ??= incomingEntity.location;
    existing.domains = [...new Set([...existing.domains, ...incomingEntity.domains])];
    existing.skills = [...new Set([...existing.skills, ...incomingEntity.skills])];

    const factIds = new Set(existing.facts.map((f) => f.id));
    for (const f of incomingEntity.facts) {
      if (!factIds.has(f.id)) {
        existing.facts.push(f);
        factIds.add(f.id);
        addedFacts += 1;
      }
    }
    const itemIds = new Set(existing.items.map((i) => i.id));
    for (const item of incomingEntity.items) {
      if (!itemIds.has(item.id)) {
        existing.items.push(item);
        itemIds.add(item.id);
        addedItems += 1;
      }
    }
  }

  return { memory, addedEntities, addedFacts, addedItems };
}

// ---------- source documents ----------

/** Where a file lives. Resumes double as sources but keep their own folder. */
export type Bucket = "sources" | "resumes";

function dirFor(bucket: Bucket): string {
  return bucket === "resumes" ? RESUMES_DIR : SOURCES_DIR;
}

/**
 * Filenames arriving from the UI are KEYS, never paths. Everything is
 * basename'd and re-checked against a directory listing before use.
 */
function safeName(filename: string): string {
  return path.basename(filename).replace(/[/\\]/g, "_");
}

export interface SourceFile {
  name: string;
  bucket: Bucket;
  bytes: number;
  modifiedAt: string;
  sha: string;
}

async function listBucket(bucket: Bucket): Promise<SourceFile[]> {
  await ensureDirs();
  const dir = dirFor(bucket);
  const entries = await fs.readdir(dir);
  const out: SourceFile[] = [];
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const full = path.join(dir, name);
    const stat = await fs.stat(full);
    if (!stat.isFile()) continue;
    out.push({
      name,
      bucket,
      bytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      sha: createHash("sha1").update(await fs.readFile(full)).digest("hex").slice(0, 12),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listSourceFiles(): Promise<SourceFile[]> {
  const [sources, resumes] = await Promise.all([
    listBucket("sources"),
    listBucket("resumes"),
  ]);
  return [...sources, ...resumes];
}

export async function resolveSourceFile(
  name: string,
  bucket: Bucket
): Promise<string | null> {
  const allowed = await listBucket(bucket);
  const target = safeName(name);
  return allowed.some((f) => f.name === target) ? path.join(dirFor(bucket), target) : null;
}

/** Save an uploaded file, never overwriting: "notes.md" → "notes (2).md". */
export async function saveSourceUpload(
  filename: string,
  data: Buffer,
  bucket: Bucket = "sources"
): Promise<string> {
  await ensureDirs();
  const base = safeName(filename) || "upload";
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length) || "upload";
  const dir = dirFor(bucket);

  let candidate = base;
  let n = 2;
  while (true) {
    try {
      await fs.access(path.join(dir, candidate));
      candidate = `${stem} (${n++})${ext}`;
    } catch {
      break;
    }
  }
  await fs.writeFile(path.join(dir, candidate), data);
  return candidate;
}

export async function deleteSourceFile(name: string, bucket: Bucket): Promise<boolean> {
  const resolved = await resolveSourceFile(name, bucket);
  if (!resolved) return false;
  await fs.unlink(resolved);
  return true;
}

// ---------- ingest ledger ----------

export interface LedgerEntry {
  sha: string;
  absorbedAt: string;
  entities: number;
  facts: number;
  items: number;
}

export type Ledger = Record<string, LedgerEntry>;

export async function loadLedger(): Promise<Ledger> {
  await ensureDirs();
  try {
    return JSON.parse(await fs.readFile(LEDGER_PATH, "utf-8")) as Ledger;
  } catch {
    return {};
  }
}

export async function recordAbsorbed(
  key: string,
  entry: LedgerEntry
): Promise<void> {
  const ledger = await loadLedger();
  ledger[key] = entry;
  await fs.writeFile(LEDGER_PATH, JSON.stringify(ledger, null, 2), "utf-8");
}

/** Status of a file relative to what memory has already absorbed. */
export type SourceStatus = "new" | "absorbed" | "changed";

export function statusOf(file: SourceFile, ledger: Ledger): SourceStatus {
  const entry = ledger[`${file.bucket}/${file.name}`];
  if (!entry) return "new";
  return entry.sha === file.sha ? "absorbed" : "changed";
}

// ---------- resumes (read-only) ----------

export async function listResumes(): Promise<string[]> {
  await ensureDirs();
  const entries = await fs.readdir(RESUMES_DIR);
  return entries.filter((f) => f.toLowerCase().endsWith(".docx")).sort();
}

/** Resolve a UI-supplied name against the allowlist. Never joins raw input. */
export async function resolveResume(name: string): Promise<string | null> {
  const allowed = await listResumes();
  return allowed.includes(name) ? path.join(RESUMES_DIR, name) : null;
}

// ---------- exports (new files only; originals are never touched) ----------

export async function writeExport(filename: string, data: Buffer): Promise<string> {
  await ensureDirs();
  const safe = path.basename(filename).replace(/[^a-zA-Z0-9._ -]/g, "_");
  const target = path.join(EXPORTS_DIR, safe);
  await fs.writeFile(target, data);
  return target;
}

// ---------- sessions ----------

const ID_RE = /^[a-zA-Z0-9-]+$/;

export async function saveSession(id: string, data: unknown): Promise<void> {
  if (!ID_RE.test(id)) throw new Error(`Invalid session id: ${id}`);
  await ensureDirs();
  await fs.writeFile(
    path.join(SESSIONS_DIR, `${id}.json`),
    JSON.stringify(data, null, 2),
    "utf-8"
  );
}

export async function loadSession<T>(id: string): Promise<T | null> {
  if (!ID_RE.test(id)) return null;
  try {
    const raw = await fs.readFile(path.join(SESSIONS_DIR, `${id}.json`), "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function deleteSession(id: string): Promise<void> {
  if (!ID_RE.test(id)) return;
  await fs.rm(path.join(SESSIONS_DIR, `${id}.json`), { force: true });
}

export async function listSessions(): Promise<string[]> {
  await ensureDirs();
  const entries = await fs.readdir(SESSIONS_DIR);
  return entries
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort()
    .reverse();
}

// ---------- calibration ----------

/**
 * Bullets the candidate has judged themselves. The strongest ground truth this
 * tool has: they know which of their accomplishments are genuinely impressive
 * and the model is guessing. Starts empty and works fine empty.
 */
export async function loadCalibration(): Promise<CalibrationExample[]> {
  await ensureDirs();
  try {
    return JSON.parse(await fs.readFile(CALIBRATION_PATH, "utf-8")) as CalibrationExample[];
  } catch {
    return [];
  }
}

export async function addCalibration(example: CalibrationExample): Promise<CalibrationExample[]> {
  const all = await loadCalibration();
  const next = [example, ...all.filter((e) => e.text !== example.text)].slice(0, 40);
  await fs.writeFile(CALIBRATION_PATH, JSON.stringify(next, null, 2), "utf-8");
  return next;
}
