// ResumeDoc → .docx. This writes a NEW file into data/exports/; the resume
// you uploaded is never opened for writing.
//
// Two rules govern the layout, both learned from Word rendering this badly:
//
// 1. Never inherit a Word built-in style. `HeadingLevel.HEADING_2` renders as
//    blue Calibri Light, and an inline bold/size run does NOT override the
//    style's colour — so headings came out blue. Every style is redefined
//    below, with an explicit colour, so Word has nothing of its own to inject.
// 2. Never use an empty paragraph as a horizontal rule. An empty paragraph
//    still occupies a full line, which left a gap between the heading and its
//    underline. The border belongs on the heading paragraph itself.

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  TabStopType,
  TextRun,
} from "docx";
import type { ResumeDoc } from "./model";

const INK = "000000";
const PAGE_MARGIN = 720; // 0.5"
// US Letter is 12240 twips wide; the usable column is the page minus both
// margins. TabStopPosition.MAX assumes 1" margins and would stop short of the
// edge here, leaving locations and dates floating mid-line instead of flush
// right.
const RIGHT_MARGIN = 12240 - PAGE_MARGIN * 2;

// Sizes are half-points: 20 = 10pt. Spacing is twips: 20 = 1pt.
const BODY_SIZE = 20;
const NAME_SIZE = 30;
const CONTACT_SIZE = 18;
const HEADING_SIZE = 22;

const BULLET_REF = "resume-bullets";

/** "Left text ............ Right text" via a right-aligned tab stop. */
function twoColumn(
  left: string,
  right: string | null,
  opts: { bold?: boolean; italics?: boolean } = {}
): Paragraph {
  const runs = [
    new TextRun({ text: left, bold: opts.bold, italics: opts.italics, color: INK }),
  ];
  if (right) {
    runs.push(
      new TextRun({
        text: `\t${right}`,
        bold: opts.bold,
        italics: opts.italics,
        color: INK,
      })
    );
  }
  return new Paragraph({
    children: runs,
    tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_MARGIN }],
    spacing: { after: 0 },
  });
}

export async function docToDocx(doc: ResumeDoc): Promise<Buffer> {
  const children: Paragraph[] = [];

  if (doc.header.name) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 20 },
        children: [
          new TextRun({ text: doc.header.name, bold: true, size: NAME_SIZE, color: INK }),
        ],
      })
    );
  }
  if (doc.header.contactLine) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
        children: [
          new TextRun({ text: doc.header.contactLine, size: CONTACT_SIZE, color: INK }),
        ],
      })
    );
  }

  for (const section of doc.sections) {
    // Heading carries its own underline — no separate rule paragraph.
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 60 },
        border: {
          bottom: { color: INK, style: BorderStyle.SINGLE, size: 6, space: 2 },
        },
        children: [
          new TextRun({
            text: section.title.toUpperCase(),
            bold: true,
            size: HEADING_SIZE,
            color: INK,
          }),
        ],
      })
    );

    for (const [index, entry] of section.entries.entries()) {
      if (entry.org || entry.location) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: entry.org ?? "", bold: true, color: INK }),
              ...(entry.location
                ? [new TextRun({ text: `\t${entry.location}`, color: INK })]
                : []),
            ],
            tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_MARGIN }],
            spacing: { before: index === 0 ? 0 : 120, after: 0 },
          })
        );
      }
      if (entry.role || entry.dates) {
        children.push(twoColumn(entry.role ?? "", entry.dates, { italics: true }));
      }

      for (const list of entry.inlineLists) {
        children.push(
          new Paragraph({
            spacing: { after: 0 },
            children: [
              new TextRun({ text: `${list.label}: `, bold: true, color: INK }),
              new TextRun({
                text: list.values.map((v) => v.text).join(", "),
                color: INK,
              }),
            ],
          })
        );
      }

      for (const bullet of entry.bullets) {
        children.push(
          new Paragraph({
            numbering: { reference: BULLET_REF, level: 0 },
            spacing: { after: 20, line: 240 },
            children: [new TextRun({ text: bullet.text, color: INK })],
          })
        );
      }
    }
  }

  const document = new Document({
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: BODY_SIZE, color: INK },
          paragraph: { spacing: { line: 240, after: 0 } },
        },
        // Redefined so Word's blue Heading 2 never appears. Keeping the
        // heading level (rather than styling a plain paragraph) preserves the
        // document outline, which some resume parsers use for sectioning.
        heading2: {
          run: { font: "Calibri", size: HEADING_SIZE, bold: true, color: INK },
          paragraph: { spacing: { before: 200, after: 60 } },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: BULLET_REF,
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: {
                // Tight hanging indent; Word's default list indent pushes the
                // text a half inch right and wastes the line.
                paragraph: { indent: { left: 227, hanging: 227 } },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: PAGE_MARGIN,
              bottom: PAGE_MARGIN,
              left: PAGE_MARGIN,
              right: PAGE_MARGIN,
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(document);
}

/** "my-resume.docx" + "Staff Engineer" → a dated filename. */
export function exportFilename(baseResume: string, label: string | null): string {
  const stem = baseResume.replace(/\.docx$/i, "");
  const slug = (label ?? "tailored")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const date = new Date().toISOString().slice(0, 10);
  return `${stem} — ${slug} ${date}.docx`;
}
