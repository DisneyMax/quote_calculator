import { getDocument, GlobalWorkerOptions } from "./vendor/pdfjs/pdf.min.mjs";

GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;

function pageLines(items) {
  const fragments = items.filter(item => item.str?.trim()).sort((first, second) =>
    second.transform[5] - first.transform[5] || first.transform[4] - second.transform[4]);
  const rows = [];
  for (const fragment of fragments) {
    const previous = rows.at(-1);
    if (previous && previous.y - fragment.transform[5] <= 2.5) previous.fragments.push(fragment);
    else rows.push({ y: fragment.transform[5], fragments: [fragment] });
  }
  return rows.map(row => row.fragments.sort((first, second) => first.transform[4] - second.transform[4])
    .map(fragment => fragment.str.trim()).join(" ").replace(/\s+/g, " ").trim());
}

export async function readPdfLines(data) {
  const task = getDocument({ data, isEvalSupported: false, useSystemFonts: false, useWasm: false, stopAtErrors: true });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 50) throw new Error("Choose an order confirmation with up to 50 pages.");
    const lines = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      lines.push(...pageLines((await page.getTextContent()).items));
    }
    if (!lines.length) throw new Error("This PDF has no readable text. Use a text PDF or import CSV.");
    return lines;
  } finally {
    await task.destroy();
  }
}
