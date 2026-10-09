// components/market modal/pdfText.js
//
// PDF TEXT EXTRACTION — reads the text layer of an uploaded price-list PDF
// with pdf.js, page by page, and calls back into receiptOcr.js for pages
// that have no text layer (scanned documents) so they go through OCR
// instead.
//
// Contract:  extractPdfText(file, { onProgress, signal, ocrPage }) -> Promise<string>
//
// This module knows pdf.js only; the tesseract side lives in receiptOcr.js
// (ocrPage receives a pdf.js Page and returns its text). The PDF never
// leaves the device: pdf.js runs in a worker Vite ships with the app.
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import workerSrc from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { groupPdfLines } from "./pdfLines.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

// pdf.js (4.4+) calls Promise.withResolvers, which older Safari and
// Firefox do not have. The polyfill must exist before any pdf.js call
// reaches it — it is only used inside functions, so running right after
// the imports is safe.
if (typeof Promise.withResolvers !== "function") {
  Promise.withResolvers = function withResolvers() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// A price list is a few pages. Beyond this the upload is a different kind
// of document, and paging it through the main thread would freeze the tab —
// staff should upload just the pages with prices.
const MAX_PDF_PAGES = 30;

const abortSignalError = () => {
  const error = new Error("PDF read aborted");
  error.name = "AbortError";
  return error;
};

export async function extractPdfText(file, { onProgress, signal, ocrPage } = {}) {
  if (!file) throw new Error("No PDF file to read");

  // pdf.js takes ownership of the buffer (it may transfer it to the
  // worker), so a fresh copy per call keeps the File untouched.
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });

  // Cancel is cooperative: destroying the loading task settles every
  // pending promise (load, page, text extraction) with an error.
  const onAbort = () => {
    loadingTask.destroy().catch(() => {
      // already destroyed
    });
  };
  if (signal) signal.addEventListener("abort", onAbort, { once: true });

  try {
    let pdf;
    try {
      pdf = await loadingTask.promise;
    } catch (error) {
      if (error && error.name === "PasswordException") {
        throw new Error(
          "That PDF is password-protected — remove the password and upload it again.",
          { cause: error }
        );
      }
      throw error;
    }

    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new Error(
        `That PDF has ${pdf.numPages} pages — please upload only the price-list pages (up to ${MAX_PDF_PAGES}).`
      );
    }

    const pageTexts = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      if (signal && signal.aborted) throw abortSignalError();

      onProgress?.({
        status: "reading pdf",
        progress: (pageNumber - 1) / pdf.numPages,
        page: pageNumber,
        totalPages: pdf.numPages,
      });

      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines = groupPdfLines(
        (content.items || []).map((item) => ({
          str: item.str,
          x: item.transform && item.transform[4],
          y: item.transform && item.transform[5],
          width: item.width,
        }))
      );
      let text = lines.join("\n");

      // A scanned page has no text layer at all — hand it to the OCR
      // engine instead of silently contributing nothing.
      if (!text.trim() && typeof ocrPage === "function") {
        if (signal && signal.aborted) throw abortSignalError();
        onProgress?.({
          status: "scanning pdf page",
          progress: (pageNumber - 1) / pdf.numPages,
          page: pageNumber,
          totalPages: pdf.numPages,
        });
        text = String((await ocrPage(page, pageNumber)) || "");
      }

      if (text.trim()) pageTexts.push(text);
    }

    onProgress?.({ status: "reading pdf", progress: 1, page: pdf.numPages, totalPages: pdf.numPages });
    return pageTexts.join("\n\n").trim();
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
    // Releases the worker and the document; safe to call twice (abort
    // already destroyed it) because destroy() failures are swallowed here.
    await loadingTask.destroy().catch(() => {
      // already destroyed by the abort path
    });
  }
}
