// Page-fit model. A resume that spills onto a second page has failed, but one
// that squeezes to 9pt and then leaves three inches of white at the bottom has
// failed differently. Fitting is therefore two decisions, not one:
//
//   1. Type scale — the largest body size whose content fits at MINIMUM
//      spacing. This is the readability decision.
//   2. Spacing — grow the gaps between entries and sections until the page is
//      full. This is the balance decision, and it is what stops a fitted
//      resume from looking cramped at the top and empty at the bottom.
//
// The same model is used by the exporter, the preview, and the tailoring
// prompt, so the page budget has one definition rather than three.

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

interface TypeScale {
  name: string;
  bodySize: number;
  nameSize: number;
  contactSize: number;
  headingSize: number;
  line: number;
  margin: number;
}

const PAGE_WIDTH = 12240; // US Letter
const PAGE_HEIGHT = 15840;

/**
 * Largest first. Nothing drops below 9pt body text — past that it reads as
 * desperate, and recruiters notice before they read a word.
 */
const TYPE_SCALES: TypeScale[] = [
  { name: "comfortable", bodySize: 20, nameSize: 32, contactSize: 18, headingSize: 22, line: 240, margin: 720 },
  { name: "snug", bodySize: 20, nameSize: 30, contactSize: 18, headingSize: 22, line: 232, margin: 648 },
  { name: "tight", bodySize: 19, nameSize: 28, contactSize: 17, headingSize: 21, line: 222, margin: 576 },
  { name: "compact", bodySize: 18, nameSize: 27, contactSize: 16, headingSize: 20, line: 212, margin: 540 },
];

/** Spacing floor — legible, but everything pulled in as far as it should go. */
const MIN_SPACING = {
  headingBefore: 100,
  headingAfter: 30,
  entryBefore: 60,
  bulletAfter: 0,
};

/** Spacing ceiling — airy without looking padded. */
const MAX_SPACING = {
  headingBefore: 280,
  headingAfter: 90,
  entryBefore: 190,
  bulletAfter: 40,
};

/**
 * How much of the page the estimate is allowed to claim.
 *
 * Deliberately not 1.0. The height model is an approximation — Word's real
 * wrapping, widow control and border spacing all move the last line around —
 * and measured against real exports it runs a few percent optimistic. Being a
 * line short is invisible; being a line over costs an entire second page.
 *
 * This is not wasted space: whatever the content does not need is redistributed
 * into the gaps by the spacing pass below, so a lower target yields an airier
 * page rather than a half-empty one.
 */
const FILL_TARGET = 0.9;

export const DEFAULT_TYPOGRAPHY: Typography = {
  ...TYPE_SCALES[0],
  ...MAX_SPACING,
};

export function usableWidth(t: Pick<Typography, "margin">): number {
  return PAGE_WIDTH - t.margin * 2;
}

export function usableHeight(t: Pick<Typography, "margin">): number {
  return PAGE_HEIGHT - t.margin * 2;
}

/**
 * Average glyph width for Calibri, measured against real exports rather than
 * font metrics: a rendered bullet wraps at about 103 characters across a 7.1in
 * column at 9pt. An optimistic figure here is the dangerous direction, because
 * every under-counted wrap is a line the page has to find room for.
 */
const CALIBRI_CHAR_WIDTH = 5.9;

function charsPerLine(t: Pick<Typography, "bodySize" | "margin">, indent = 0): number {
  const charWidth = CALIBRI_CHAR_WIDTH * t.bodySize;
  return Math.max(20, Math.floor((usableWidth(t) - indent) / charWidth));
}

function wrappedLines(text: string, perLine: number): number {
  return Math.max(1, Math.ceil(text.length / perLine));
}

/**
 * Height of one rendered line, in twips.
 *
 * `line` is not a twip count: in OOXML w:line with the default auto rule is a
 * multiple of single spacing where 240 = 1.0. Treating it as twips understated
 * every paragraph and let documents overflow while the model reported them as
 * fitting.
 *
 * The 1.33 factor is Word's own single-spaced line for Calibri, not the font's
 * nominal 1.22 metric — 11pt Calibri sets at about 14.65pt. Using the nominal
 * figure under-counted every paragraph by roughly 9%, which was enough to push
 * a "96% full" page onto a second sheet.
 */
const CALIBRI_LINE_FACTOR = 1.33;

function lineHeight(halfPoints: number, line = 240): number {
  return (CALIBRI_LINE_FACTOR * (halfPoints / 2) * 20 * line) / 240;
}

/** Rendered height of the document in twips under the given typography. */
export function estimateHeight(doc: ResumeDoc, t: Typography): number {
  const bodyPerLine = charsPerLine(t);
  const bulletPerLine = charsPerLine(t, 227);
  let height = 0;

  // Mirrors the exporter's header block exactly, spacing included.
  if (doc.header.name) height += lineHeight(t.nameSize) + 40;
  if (doc.header.contactLine) height += lineHeight(t.contactSize) + 60;

  const body = lineHeight(t.bodySize, t.line);

  for (const section of doc.sections) {
    height += t.headingBefore + lineHeight(t.headingSize) + t.headingAfter;

    for (const [index, entry] of section.entries.entries()) {
      if (entry.org || entry.location) {
        height += body + (index === 0 ? 0 : t.entryBefore);
      }
      if (entry.role || entry.dates) height += body;

      for (const list of entry.inlineLists) {
        const text = `${list.label}: ${list.values.map((v) => v.text).join(", ")}`;
        height += body * wrappedLines(text, bodyPerLine);
      }
      for (const bullet of entry.bullets) {
        height += body * wrappedLines(bullet.text, bulletPerLine) + t.bulletAfter;
      }
    }
  }
  return height;
}

/** Blend the spacing floor toward the ceiling; t = 0 is tightest, 1 is airiest. */
function spacingAt(scale: TypeScale, t: number): Typography {
  const lerp = (min: number, max: number) => Math.round(min + (max - min) * t);
  return {
    ...scale,
    headingBefore: lerp(MIN_SPACING.headingBefore, MAX_SPACING.headingBefore),
    headingAfter: lerp(MIN_SPACING.headingAfter, MAX_SPACING.headingAfter),
    entryBefore: lerp(MIN_SPACING.entryBefore, MAX_SPACING.entryBefore),
    bulletAfter: lerp(MIN_SPACING.bulletAfter, MAX_SPACING.bulletAfter),
  };
}

export interface Fit {
  typography: Typography;
  /** Fraction of the page consumed, 0-1 when it fits. */
  pages: number;
  /** How many body lines over one page, 0 when it fits. */
  overflowLines: number;
  /** True when even the tightest setting spills — content has to come out. */
  needsCuts: boolean;
}

/**
 * Largest readable type that fits, with the leftover space distributed into
 * the gaps rather than left pooling at the bottom of the page.
 */
export function fitToOnePage(doc: ResumeDoc): Fit {
  for (const scale of TYPE_SCALES) {
    const budget = usableHeight(scale) * FILL_TARGET;
    if (estimateHeight(doc, spacingAt(scale, 0)) > budget) continue;

    // This scale fits at minimum spacing; open the gaps up as far as the page
    // allows. Twenty steps resolves finer than a reader could notice.
    let best = spacingAt(scale, 0);
    for (let step = 1; step <= 20; step++) {
      const candidate = spacingAt(scale, step / 20);
      if (estimateHeight(doc, candidate) <= budget) best = candidate;
      else break;
    }
    return {
      typography: best,
      pages: estimateHeight(doc, best) / usableHeight(best),
      overflowLines: 0,
      needsCuts: false,
    };
  }

  // Nothing fit the safety budget. That is not the same as not fitting the
  // page: the budget is deliberately conservative, so fall back to the tightest
  // setting and judge "does content have to come out?" against the real page.
  const typography = spacingAt(TYPE_SCALES[TYPE_SCALES.length - 1], 0);
  const height = estimateHeight(doc, typography);
  const over = height - usableHeight(typography);
  return {
    typography,
    pages: height / usableHeight(typography),
    overflowLines: over > 0 ? Math.ceil(over / lineHeight(typography.bodySize, typography.line)) : 0,
    needsCuts: over > 0,
  };
}

/**
 * The budget handed to the tailoring prompt. Expressed in lines because that
 * is the unit the model can reason about while writing.
 */
export function lineBudget(): { totalLines: number; charsPerBulletLine: number } {
  const t = DEFAULT_TYPOGRAPHY;
  return {
    totalLines: Math.floor(
      (usableHeight(t) * FILL_TARGET) / lineHeight(t.bodySize, t.line)
    ),
    charsPerBulletLine: charsPerLine(t, 227),
  };
}
