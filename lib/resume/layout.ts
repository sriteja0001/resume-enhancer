// Page-fit model. A resume that spills onto a second page has failed, but the
// model writing it has no sense of physical space — it gets a per-bullet
// character limit and nothing about the document. This module measures the
// rendered height so three different places can act on it:
//
//   - the exporter picks the loosest typography that still fits one page
//   - the UI warns before you open Word and discover the overflow
//   - the tailoring prompt receives a line budget it can prioritise against
//
// Estimates, not a rendering engine: accurate to roughly a line or two, which
// is the resolution the decisions actually need.

import type { ResumeDoc } from "./model";

/** All dimensions in twips (1/20 pt); font sizes in half-points, as docx wants. */
export interface Typography {
  name: string;
  bodySize: number;
  nameSize: number;
  contactSize: number;
  headingSize: number;
  line: number;
  margin: number;
  headingBefore: number;
  headingAfter: number;
  entryBefore: number;
  bulletAfter: number;
}

const PAGE_WIDTH = 12240; // US Letter
const PAGE_HEIGHT = 15840;

/**
 * Loosest first. Each step is still a resume someone would be happy to hand
 * over; nothing here drops below 9pt body text, because past that it reads as
 * desperate and recruiters notice.
 */
export const PRESETS: Typography[] = [
  {
    name: "comfortable",
    bodySize: 20,
    nameSize: 30,
    contactSize: 18,
    headingSize: 22,
    line: 240,
    margin: 720,
    headingBefore: 200,
    headingAfter: 60,
    entryBefore: 120,
    bulletAfter: 20,
  },
  {
    name: "snug",
    bodySize: 20,
    nameSize: 28,
    contactSize: 17,
    headingSize: 21,
    line: 228,
    margin: 648,
    headingBefore: 150,
    headingAfter: 45,
    entryBefore: 90,
    bulletAfter: 10,
  },
  {
    name: "tight",
    bodySize: 19,
    nameSize: 27,
    contactSize: 17,
    headingSize: 20,
    line: 218,
    margin: 576,
    headingBefore: 120,
    headingAfter: 40,
    entryBefore: 70,
    bulletAfter: 10,
  },
  {
    name: "compact",
    bodySize: 18,
    nameSize: 26,
    contactSize: 16,
    headingSize: 19,
    line: 208,
    margin: 540,
    headingBefore: 100,
    headingAfter: 30,
    entryBefore: 60,
    bulletAfter: 0,
  },
];

export const DEFAULT_TYPOGRAPHY = PRESETS[0];

export function usableWidth(t: Typography): number {
  return PAGE_WIDTH - t.margin * 2;
}

export function usableHeight(t: Typography): number {
  return PAGE_HEIGHT - t.margin * 2;
}

/**
 * Average glyph width for Calibri, calibrated so 10pt across a 7.5in column
 * comes out near 100 characters — which matches what Word actually fits.
 */
function charsPerLine(t: Typography, indent = 0): number {
  const charWidth = 5.4 * t.bodySize;
  return Math.max(20, Math.floor((usableWidth(t) - indent) / charWidth));
}

function wrappedLines(text: string, perLine: number): number {
  return Math.max(1, Math.ceil(text.length / perLine));
}

/** Rendered height of the document in twips under the given typography. */
export function estimateHeight(doc: ResumeDoc, t: Typography): number {
  const bodyPerLine = charsPerLine(t);
  const bulletPerLine = charsPerLine(t, 227);
  let height = 0;

  if (doc.header.name) height += t.nameSize * 12 + 20;
  if (doc.header.contactLine) height += t.contactSize * 12 + 100;

  for (const section of doc.sections) {
    height += t.headingBefore + t.headingSize * 12 + t.headingAfter;

    for (const [index, entry] of section.entries.entries()) {
      if (entry.org || entry.location) {
        height += t.line + (index === 0 ? 0 : t.entryBefore);
      }
      if (entry.role || entry.dates) height += t.line;

      for (const list of entry.inlineLists) {
        const text = `${list.label}: ${list.values.map((v) => v.text).join(", ")}`;
        height += t.line * wrappedLines(text, bodyPerLine);
      }
      for (const bullet of entry.bullets) {
        height += t.line * wrappedLines(bullet.text, bulletPerLine) + t.bulletAfter;
      }
    }
  }
  return height;
}

export interface Fit {
  typography: Typography;
  pages: number;
  /** How many body lines over one page, 0 when it fits. */
  overflowLines: number;
  /** True when even the tightest preset spills — content has to come out. */
  needsCuts: boolean;
}

/** Loosest typography that still fits on one page, or the tightest we allow. */
export function fitToOnePage(doc: ResumeDoc): Fit {
  for (const typography of PRESETS) {
    const height = estimateHeight(doc, typography);
    if (height <= usableHeight(typography)) {
      return { typography, pages: height / usableHeight(typography), overflowLines: 0, needsCuts: false };
    }
  }
  const typography = PRESETS[PRESETS.length - 1];
  const height = estimateHeight(doc, typography);
  const over = height - usableHeight(typography);
  return {
    typography,
    pages: height / usableHeight(typography),
    overflowLines: Math.ceil(over / typography.line),
    needsCuts: true,
  };
}

/**
 * The budget handed to the tailoring prompt. Expressed in lines because that
 * is the unit the model can reason about while writing.
 */
export function lineBudget(t: Typography = DEFAULT_TYPOGRAPHY): {
  totalLines: number;
  charsPerBulletLine: number;
} {
  return {
    totalLines: Math.floor(usableHeight(t) / t.line),
    charsPerBulletLine: charsPerLine(t, 227),
  };
}
