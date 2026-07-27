// Storage seam: the only module allowed to touch the filesystem. Layout:
//
//   data/memory/master.md   the knowledge base (source of truth)
//   data/resumes/*.docx     your resumes, read-only — never modified
//   data/exports/*.docx     resumes this app generates (new files only)
//   data/sessions/*.json    tailoring sessions (mockup + chat + rationale)

import { promises as fs } from "fs";
import path from "path";
import { parseMemory, serializeMemory } from "./markdown";
import type { Entity, Memory } from "./types";
import { EMPTY_MEMORY } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const MEMORY_DIR = path.join(DATA_DIR, "memory");
const MASTER_PATH = path.join(MEMORY_DIR, "master.md");
const RESUMES_DIR = path.join(DATA_DIR, "resumes");
const EXPORTS_DIR = path.join(DATA_DIR, "exports");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");

async function ensureDirs(): Promise<void> {
  await fs.mkdir(MEMORY_DIR, { recursive: true });
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

export async function listSessions(): Promise<string[]> {
  await ensureDirs();
  const entries = await fs.readdir(SESSIONS_DIR);
  return entries
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort()
    .reverse();
}
