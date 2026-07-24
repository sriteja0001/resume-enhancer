// Storage seam. See plan §2.4 and §9: every read/write of personal data goes
// through this file, so a future move off the local filesystem (e.g. Vercel
// Blob) touches only this module. Nothing else in the app may import "fs".
//
// Layout:
//   data/profile.json   — fact bank (read/write)
//   data/resumes/*.docx — my resume files, managed in Word (READ-ONLY here)
//   data/runs/*.json    — persisted analysis sessions (read/write)

import { promises as fs } from "fs";
import path from "path";
import { EMPTY_PROFILE, type Profile, type Run } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const RESUMES_DIR = path.join(DATA_DIR, "resumes");
const RUNS_DIR = path.join(DATA_DIR, "runs");
const PROFILE_PATH = path.join(DATA_DIR, "profile.json");

/** data/ is gitignored, so it won't exist on a fresh clone — bootstrap it. */
async function ensureDataDirs(): Promise<void> {
  await fs.mkdir(RESUMES_DIR, { recursive: true });
  await fs.mkdir(RUNS_DIR, { recursive: true });
}

export async function loadProfile(): Promise<Profile> {
  await ensureDataDirs();
  try {
    const raw = await fs.readFile(PROFILE_PATH, "utf-8");
    return JSON.parse(raw) as Profile;
  } catch {
    await saveProfile(EMPTY_PROFILE);
    return EMPTY_PROFILE;
  }
}

export async function saveProfile(profile: Profile): Promise<void> {
  await ensureDataDirs();
  await fs.writeFile(PROFILE_PATH, JSON.stringify(profile, null, 2), "utf-8");
}

/**
 * List resume files. This doubles as the security allowlist (plan §10.1):
 * any resume name arriving via the API must resolve against this listing —
 * the dropdown value is a key, never a path.
 */
export async function listResumes(): Promise<string[]> {
  await ensureDataDirs();
  const entries = await fs.readdir(RESUMES_DIR);
  return entries.filter((f) => f.toLowerCase().endsWith(".docx")).sort();
}

/**
 * Resolve a user-supplied resume name to a real path, or null if it isn't in
 * the allowlist. Never joins raw input onto a path.
 */
export async function resolveResume(name: string): Promise<string | null> {
  const allowed = await listResumes();
  if (!allowed.includes(name)) return null;
  return path.join(RESUMES_DIR, name);
}

const RUN_ID_RE = /^[a-zA-Z0-9-]+$/;

export async function saveRun(run: Run): Promise<void> {
  if (!RUN_ID_RE.test(run.id)) throw new Error(`Invalid run id: ${run.id}`);
  await ensureDataDirs();
  await fs.writeFile(
    path.join(RUNS_DIR, `${run.id}.json`),
    JSON.stringify(run, null, 2),
    "utf-8"
  );
}

export async function loadRun(id: string): Promise<Run | null> {
  if (!RUN_ID_RE.test(id)) return null;
  try {
    const raw = await fs.readFile(path.join(RUNS_DIR, `${id}.json`), "utf-8");
    return JSON.parse(raw) as Run;
  } catch {
    return null;
  }
}

export async function listRuns(): Promise<string[]> {
  await ensureDataDirs();
  const entries = await fs.readdir(RUNS_DIR);
  return entries
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort()
    .reverse();
}
