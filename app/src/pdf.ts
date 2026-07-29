import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

// Identidade Codex IG (teal + coral no dark). PDF em tema CLARO (legível/imprimível) com marca teal.
const TEAL: [number, number, number] = [0, 168, 146];
const TEAL_HEAD: [number, number, number] = [0, 191, 165];
const CORAL: [number, number, number] = [255, 77, 61];
const DARK: [number, number, number] = [11, 14, 23];
const SLATE: [number, number, number] = [120, 130, 145];

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

  // ---- cabeçalho da marca (barra escura + logo teal/coral) ----
  doc.setFillColor(...DARK);
  doc.rect(0, 0, W, 58, "F");
  doc.setDrawColor(...TEAL_HEAD);
  doc.setLineWidth(3);
  doc.line(30, 40, 44, 20); // arco de momentum (aproximação da logo "orbit")
  doc.line(44, 20, 52, 30);
  doc.setFillColor(...CORAL);
  doc.circle(52, 30, 3, "F"); // ponto coral = crescimento no pico
  doc.setTextColor(0, 191, 165);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("Codex IG", 64, 28);
  doc.setTextColor(200, 205, 212);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text("GROWTH SUITE", 64, 40);

  // ---- título do relatório ----
  doc.setTextColor(...DARK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(opts.title, 40, 86, { maxWidth: W - 80 });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...SLATE);
  doc.text(opts.subtitle, 40, 102);

  const foot = (d: jsPDF) => {
    const H = d.internal.pageSize.getHeight();
    d.setFontSize(7.5);
    d.setTextColor(...SLATE);
    d.text(opts.footer, 40, H - 20);
    const page = d.getNumberOfPages();
    d.text(String(page), W - 40, H - 20, { align: "right" });
  };

  let y = 116;
  if (opts.likers.length) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...TEAL);
    doc.text(opts.likersLabel, 40, y);
    y += 8;
    autoTable(doc, {
      startY: y,
      head: [["#", opts.colUser, opts.colName]],
      body: opts.likers.map((u, i) => [String(i + 1), "@" + u.username + (u.verif ? "  ✓" : ""), u.full || "—"]),
      headStyles: { fillColor: TEAL_HEAD, textColor: [255, 255, 255], fontStyle: "bold" },
      styles: { fontSize: 8.5, cellPadding: 3, textColor: DARK },
      alternateRowStyles: { fillColor: [244, 247, 246] },
      columnStyles: { 0: { cellWidth: 30 } },
      margin: { left: 40, right: 40 },
      didDrawPage: () => foot(doc),
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24;
  }
  if (opts.comments.length) {
    if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = 60; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...TEAL);
    doc.text(opts.commentsLabel, 40, y);
    y += 8;
    autoTable(doc, {
      startY: y,
      head: [["#", opts.colUser, opts.colName, opts.colWhen, opts.colText]],
      body: opts.comments.map((c, i) => [String(i + 1), "@" + c.username + (c.verif ? "  ✓" : ""), c.full || "—", c.when, c.text]),
      headStyles: { fillColor: TEAL_HEAD, textColor: [255, 255, 255], fontStyle: "bold" },
      styles: { fontSize: 8, cellPadding: 3, textColor: DARK, overflow: "linebreak" },
      alternateRowStyles: { fillColor: [244, 247, 246] },
      columnStyles: { 0: { cellWidth: 26 }, 3: { cellWidth: 74 }, 4: { cellWidth: 200 } },
      margin: { left: 40, right: 40 },
      didDrawPage: () => foot(doc),
    });
  }

  return new Uint8Array(doc.output("arraybuffer"));
}
