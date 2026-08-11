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

// ---- Dossie de BUSCA (Monitor): resumo de inteligencia (IA) + tabela de resultados ----
type DRow = { title: string; link: string; source: string; date: string; sent: string; snippet: string };

export function exportDossierPdf(opts: {
  title: string;
  subtitle: string;
  summary: string;
  summaryLabel: string;
  rows: DRow[];
  colTitle: string;
  colSource: string;
  colSent: string;
  colSnippet: string;
  footer: string;
}): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

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

  const title = clean(opts.title).slice(0, 140) || "Dossie";
  doc.setTextColor(...DARK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  const tl = doc.splitTextToSize(title, W - 80).slice(0, 2) as string[];
  let y = 80;
  doc.text(tl, 40, y);
  y += tl.length * 16 + 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...SLATE);
  doc.text(clean(opts.subtitle), 40, y);
  y += 16;

  const foot = (d: jsPDF) => {
    d.setFontSize(7.5);
    d.setTextColor(...SLATE);
    d.text(clean(opts.footer), 40, H - 20);
    d.text(String(d.getNumberOfPages()), W - 40, H - 20, { align: "right" });
  };

  // resumo de inteligencia (IA) — bloco de texto
  if (opts.summary.trim()) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...TEAL);
    doc.text(clean(opts.summaryLabel), 40, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...DARK);
    const lines = doc.splitTextToSize(clean(opts.summary), W - 80) as string[];
    for (const ln of lines) {
      if (y > H - 40) { doc.addPage(); y = 60; }
      doc.text(ln, 40, y);
      y += 12;
    }
    y += 8;
  }

  if (y > H - 120) { doc.addPage(); y = 60; }
  autoTable(doc, {
    startY: y,
    head: [["#", clean(opts.colTitle), clean(opts.colSource), clean(opts.colSent), clean(opts.colSnippet)]],
    body: opts.rows.map((r, i) => [
      String(i + 1),
      clean(r.title).slice(0, 90),
      clean(`${r.source}${r.date ? " · " + r.date : ""}`),
      clean(r.sent),
      clean(r.snippet).slice(0, 180),
    ]),
    headStyles: { fillColor: TEAL_HEAD, textColor: [255, 255, 255], fontStyle: "bold" },
    styles: { fontSize: 8, cellPadding: 3, textColor: DARK, overflow: "linebreak", valign: "top" },
    alternateRowStyles: { fillColor: [244, 247, 246] },
    columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 130 }, 2: { cellWidth: 90 }, 3: { cellWidth: 48 } },
    margin: { left: 40, right: 40, top: 60 },
    didDrawPage: () => foot(doc),
  });

  return new Uint8Array(doc.output("arraybuffer"));
}

// ---- Relatorio UNIFICADO: 1 PDF, 1 linha por pessoa (dedup), curtidas + comentarios (com TEXTO) ----
export type UniPost = { label: string; sub: string }; // "#1", "12 jul · legenda…"
export type UniRow = {
  username: string;
  full: string;
  verif: boolean;
  liked: number[]; // indices dos posts
  commented: { post: number; text: string }[];
};

export function exportUnifiedPdf(opts: {
  title: string;
  subtitle: string;
  posts: UniPost[];
  rows: UniRow[];
  legendLabel: string;
  colUser: string;
  colName: string;
  colLiked: string;
  colCommented: string;
  footer: string;
}): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

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

  const title = clean(opts.title).slice(0, 140) || "Relatorio";
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
  y += 16;

  // legenda: #1 = data · legenda
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...TEAL);
  doc.text(clean(opts.legendLabel), 40, y);
  y += 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...DARK);
  for (const p of opts.posts) {
    const line = doc.splitTextToSize(`${clean(p.label)}  ${clean(p.sub)}`, W - 80)[0];
    doc.text(line, 44, y);
    y += 11;
  }
  y += 6;

  const foot = (d: jsPDF) => {
    d.setFontSize(7.5);
    d.setTextColor(...SLATE);
    d.text(clean(opts.footer), 40, H - 20);
    d.text(String(d.getNumberOfPages()), W - 40, H - 20, { align: "right" });
  };
  const vtag = (v: boolean) => (v ? " (verif.)" : "");
  const lab = (i: number) => opts.posts[i]?.label || `#${i + 1}`;
  const likedCell = (a: number[]) => (a.length ? a.map(lab).join(", ") : "-");
  const cmtCell = (a: { post: number; text: string }[]) =>
    a.length ? a.map((c) => `${lab(c.post)}: ${clean(c.text) || "(sem texto)"}`).join("\n") : "-";

  autoTable(doc, {
    startY: y,
    head: [["#", clean(opts.colUser), clean(opts.colName), clean(opts.colLiked), clean(opts.colCommented)]],
    body: opts.rows.map((r, i) => [
      String(i + 1),
      "@" + clean(r.username) + vtag(r.verif),
      clean(r.full) || "-",
      likedCell(r.liked),
      cmtCell(r.commented),
    ]),
    headStyles: { fillColor: TEAL_HEAD, textColor: [255, 255, 255], fontStyle: "bold" },
    styles: { fontSize: 8, cellPadding: 3, textColor: DARK, overflow: "linebreak", valign: "top" },
    alternateRowStyles: { fillColor: [244, 247, 246] },
    columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 96 }, 2: { cellWidth: 96 }, 3: { cellWidth: 60 } },
    margin: { left: 40, right: 40, top: 60 },
    didDrawPage: () => foot(doc),
  });

  return new Uint8Array(doc.output("arraybuffer"));
}
