// ResumeDoc → .docx. This writes a NEW file into data/exports/; the resume
// you uploaded is never opened for writing. Layout follows the common
// one-page convention: name, contact line, then sections with a right-aligned
// tab stop so dates and locations sit at the margin.

import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TabStopPosition,
  TabStopType,
  TextRun,
} from "docx";
import type { ResumeDoc } from "./model";

const PAGE_WIDTH_TWIPS = TabStopPosition.MAX;

function rule(): Paragraph {
  return new Paragraph({
    text: "",
    border: {
      bottom: { color: "000000", space: 1, style: "single", size: 6 },
    },
    spacing: { after: 80 },
  });
}

/** "Left text ........ Right text" via a right-aligned tab stop. */
function twoColumn(
  left: string,
  right: string | null,
  opts: { bold?: boolean; italics?: boolean } = {}
): Paragraph {
  const runs = [new TextRun({ text: left, bold: opts.bold, italics: opts.italics })];
  if (right) {
    runs.push(
      new TextRun({ text: `\t${right}`, bold: opts.bold, italics: opts.italics })
    );
  }
  return new Paragraph({
    children: runs,
    tabStops: [{ type: TabStopType.RIGHT, position: PAGE_WIDTH_TWIPS }],
    spacing: { after: 20 },
  });
}

export async function docToDocx(doc: ResumeDoc): Promise<Buffer> {
  const children: Paragraph[] = [];

  if (doc.header.name) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 40 },
        children: [new TextRun({ text: doc.header.name, bold: true, size: 32 })],
      })
    );
  }
  if (doc.header.contactLine) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 160 },
        children: [new TextRun({ text: doc.header.contactLine, size: 18 })],
      })
    );
  }

  for (const section of doc.sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 160, after: 0 },
        children: [
          new TextRun({ text: section.title.toUpperCase(), bold: true, size: 22 }),
        ],
      })
    );
    children.push(rule());

    for (const entry of section.entries) {
      if (entry.org || entry.location) {
        children.push(twoColumn(entry.org ?? "", entry.location, { bold: true }));
      }
      if (entry.role || entry.dates) {
        children.push(twoColumn(entry.role ?? "", entry.dates, { italics: true }));
      }

      for (const list of entry.inlineLists) {
        children.push(
          new Paragraph({
            spacing: { after: 20 },
            children: [
              new TextRun({ text: `${list.label}: `, bold: true }),
              new TextRun({ text: list.values.map((v) => v.text).join(", ") }),
            ],
          })
        );
      }

      for (const bullet of entry.bullets) {
        children.push(
          new Paragraph({
            text: bullet.text,
            bullet: { level: 0 },
            spacing: { after: 20 },
          })
        );
      }
    }
  }

  const document = new Document({
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 20 } },
      },
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } },
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
