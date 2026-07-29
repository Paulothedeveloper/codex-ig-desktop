import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

// Identidade Codex IG (teal + coral). PDF tema CLARO (legível/imprimível).
const TEAL: [number, number, number] = [0, 168, 146];
const TEAL_HEAD: [number, number, number] = [0, 191, 165];
const CORAL: [number, number, number] = [255, 77, 61];
const DARK: [number, number, number] = [11, 14, 23];
const SLATE: [number, number, number] = [120, 130, 145];

// A fonte padrão (helvetica) só cobre latin-1 → emoji/flags/setas viram lixo. Tira o que não é
// latin-1 imprimível (acento pt-BR á/ê/ç etc. É latin-1, fica).
function clean(s: string): string {
  return (s || "").replace(/[^\x20-\x7E\xA0-\xFF]/g, " ").replace(/\s+/g, " ").trim();
}

type U = { username: string; full: string; verif: boolean };
type C = { username: string; full: string; text: string; when: string; verif: boolean };

export function exportInteractionsPdf(opts: {
  title: string;
  subtitle: string;
  likersLabel: string;
  commentsLabel: string;
  likers: U[];
  comments: C[];
  colUser: string;
  colName: string;
  colWhen: string;
  colText: string;
  footer: string;
}): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  // ---- cabeçalho da marca ----
  doc.setFillColor(...DARK);
  doc.rect(0, 0, W, 56, "F");
  doc.setDrawColor(...TEAL_HEAD);
  doc.setLineWidth(3);
  doc.line(34, 38, 47, 20);
  doc.line(47, 20, 55, 30);
  doc.setFillColor(...CORAL);
  doc.circle(55, 30, 3, "F");
  doc.setTextColor(...TEAL_HEAD);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("Codex IG", 66, 28);
  doc.setTextColor(200, 205, 212);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text("GROWTH SUITE", 66, 40);

  // ---- título (altura dinâmica: mede quantas linhas, no máx 2) ----
  const title = clean(opts.title).slice(0, 140) || "Post";
  doc.setTextColor(...DARK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  const titleLines = doc.splitTextToSize(title, W - 80).slice(0, 2) as string[];
  let y = 80;
  doc.text(titleLines, 40, y);
  y += titleLines.length * 16 + 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...SLATE);
  doc.text(clean(opts.subtitle), 40, y);
  y += 18;

  const foot = (d: jsPDF) => {
    d.setFontSize(7.5);
    d.setTextColor(...SLATE);
    d.text(clean(opts.footer), 40, H - 20);
    d.text(String(d.getNumberOfPages()), W - 40, H - 20, { align: "right" });
  };
  const vtag = (v: boolean) => (v ? " (verif.)" : "");

  if (opts.likers.length) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...TEAL);
    doc.text(clean(opts.likersLabel), 40, y);
    y += 6;
    autoTable(doc, {
      startY: y,
      head: [["#", clean(opts.colUser), clean(opts.colName)]],
      body: opts.likers.map((u, i) => [String(i + 1), "@" + clean(u.username) + vtag(u.verif), clean(u.full) || "-"]),
      headStyles: { fillColor: TEAL_HEAD, textColor: [255, 255, 255], fontStyle: "bold" },
      styles: { fontSize: 8.5, cellPadding: 3, textColor: DARK },
      alternateRowStyles: { fillColor: [244, 247, 246] },
      columnStyles: { 0: { cellWidth: 30 } },
      margin: { left: 40, right: 40, top: 60 },
      didDrawPage: () => foot(doc),
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24;
  }
  if (opts.comments.length) {
    if (y > H - 110) { doc.addPage(); y = 60; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...TEAL);
    doc.text(clean(opts.commentsLabel), 40, y);
    y += 6;
    autoTable(doc, {
      startY: y,
      head: [["#", clean(opts.colUser), clean(opts.colName), clean(opts.colWhen), clean(opts.colText)]],
      body: opts.comments.map((c, i) => [String(i + 1), "@" + clean(c.username) + vtag(c.verif), clean(c.full) || "-", clean(c.when), clean(c.text) || "-"]),
      headStyles: { fillColor: TEAL_HEAD, textColor: [255, 255, 255], fontStyle: "bold" },
      styles: { fontSize: 8, cellPadding: 3, textColor: DARK, overflow: "linebreak" },
      alternateRowStyles: { fillColor: [244, 247, 246] },
      columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 110 }, 3: { cellWidth: 72 }, 4: { cellWidth: 170 } },
      margin: { left: 40, right: 40, top: 60 },
      didDrawPage: () => foot(doc),
    });
  }

  return new Uint8Array(doc.output("arraybuffer"));
}
