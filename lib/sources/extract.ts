// Text extraction for every kind of document you'd feed the knowledge base.
// Files — not a textarea — are the primary way information gets in, because
// the things worth remembering already live in files: a research summary, a
// transcript, a running list of everything you did in high school.

import { promises as fs } from "fs";
import path from "path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

export const SUPPORTED_EXTENSIONS = [".docx", ".md", ".txt", ".pdf"] as const;
export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

export function extensionOf(filename: string): string {
  return path.extname(filename).toLowerCase();
}

export function isSupported(filename: string): boolean {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(extensionOf(filename));
}

/** Human label for the file list. */
export function kindOf(filename: string): string {
  switch (extensionOf(filename)) {
    case ".docx":
      return "Word";
    case ".pdf":
      return "PDF";
    case ".md":
      return "Markdown";
    case ".txt":
      return "Text";
    default:
      return "file";
  }
}

export interface Extracted {
  text: string;
  /** Set when the file parsed but yielded almost nothing worth absorbing. */
  warning: string | null;
}

async function extractPdf(filePath: string): Promise<Extracted> {
  const parser = new PDFParse({ data: await fs.readFile(filePath) });
  try {
    const { text } = await parser.getText();
    // Strip the page-footer markers the parser injects.
    const cleaned = (text ?? "").replace(/^--\s*\d+\s+of\s+\d+\s*--$/gm, "").trim();
    return {
      text: cleaned,
      warning:
        cleaned.length < 40
          ? "Almost no text came out — this PDF is probably a scan. Export a text-based PDF, or paste the content into the text box instead."
          : null,
    };
  } finally {
    await parser.destroy?.();
  }
}

export async function extractFile(filePath: string): Promise<Extracted> {
  const ext = extensionOf(filePath);

  if (ext === ".pdf") return extractPdf(filePath);

  if (ext === ".docx") {
    // Raw text is right here: unlike a resume, a prose document carries no
    // load-bearing list/bold structure worth preserving.
    const { value } = await mammoth.extractRawText({ path: filePath });
    const text = value.trim();
    return {
      text,
      warning: text.length < 40 ? "This file appears to be empty." : null,
    };
  }

  const text = (await fs.readFile(filePath, "utf-8")).trim();
  return {
    text,
    warning: text.length < 40 ? "This file appears to be empty." : null,
  };
}
