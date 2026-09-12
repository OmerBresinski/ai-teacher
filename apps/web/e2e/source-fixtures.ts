/** Generated Source material for the brief's drop zone specs (ADR 0027 §7): no binaries in git. */

/**
 * A one-page PDF with real text, built by hand so the web app needs no PDF library. The text is
 * wrapped into short lines: pdfjs drops what a single `Tj` run paints past the page edge.
 */
export function tinyPdf(text: string): Buffer {
  const words = text.replace(/[()\\]/g, "").split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).length > 60) {
      lines.push(line.trim());
      line = "";
    }
    line += ` ${word}`;
  }
  if (line.trim()) lines.push(line.trim());
  const content = `BT /F1 14 Tf 50 780 Td 18 TL ${lines.map((l) => `(${l}) Tj T*`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

export const MATERIAL =
  "Photosynthesis is the process by which green plants make their own food. Light energy from the sun is absorbed by chlorophyll in the leaves and used to turn carbon dioxide and water into glucose and oxygen. Plants need light, water and carbon dioxide.";
