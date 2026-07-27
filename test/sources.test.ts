// Source documents are the primary intake path, so the pieces that decide
// what's readable and what still needs absorbing are worth pinning down.
// Run with: npm test

import assert from "node:assert/strict";
import { test } from "node:test";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import {
  SUPPORTED_EXTENSIONS,
  extensionOf,
  extractFile,
  isSupported,
  kindOf,
} from "../lib/sources/extract";
import { statusOf, type Ledger, type SourceFile } from "../lib/memory/store";

test("supported types cover the documents people actually keep", () => {
  assert.deepEqual([...SUPPORTED_EXTENSIONS], [".docx", ".md", ".txt", ".pdf"]);
  assert.ok(isSupported("research summary.PDF"), "extension check is case-insensitive");
  assert.ok(isSupported("high-school.md"));
  assert.ok(!isSupported("photo.png"));
  assert.ok(!isSupported("notes"));
  assert.equal(extensionOf("A.Long.Name.docx"), ".docx");
  assert.equal(kindOf("x.pdf"), "PDF");
  assert.equal(kindOf("x.md"), "Markdown");
});

test("markdown and text files are read verbatim", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "src-"));
  const file = path.join(dir, "high-school.md");
  await fs.writeFile(file, "# Record\n- Placed 2nd at state in Chemistry Lab.\n");

  const out = await extractFile(file);
  assert.match(out.text, /Placed 2nd at state in Chemistry Lab/);
  assert.equal(out.warning, null);
  await fs.rm(dir, { recursive: true, force: true });
});

test("an empty file warns instead of silently absorbing nothing", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "src-"));
  const file = path.join(dir, "blank.txt");
  await fs.writeFile(file, "   \n  ");

  const out = await extractFile(file);
  assert.equal(out.text, "");
  assert.ok(out.warning, "a warning is surfaced rather than a silent no-op");
  await fs.rm(dir, { recursive: true, force: true });
});

const file = (sha: string): SourceFile => ({
  name: "high-school.md",
  bucket: "sources",
  bytes: 100,
  modifiedAt: new Date(0).toISOString(),
  sha,
});

test("file status distinguishes new, absorbed, and edited-since-absorbed", () => {
  const empty: Ledger = {};
  assert.equal(statusOf(file("aaa"), empty), "new");

  const ledger: Ledger = {
    "sources/high-school.md": {
      sha: "aaa",
      absorbedAt: new Date(0).toISOString(),
      entities: 1,
      facts: 4,
      items: 5,
    },
  };
  assert.equal(statusOf(file("aaa"), ledger), "absorbed");
  // Editing the file changes its hash, so it needs absorbing again.
  assert.equal(statusOf(file("bbb"), ledger), "changed");
});
