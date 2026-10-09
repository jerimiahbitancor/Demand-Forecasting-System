// components/market modal/receiptOcr.js
//
// OCR ENGINE ADAPTER — the only file in the receipt feature that knows which
// recognition engine is running.
//
// Contract:  recognizeReceipt(file, { onProgress, signal }) -> Promise<string>
//
// The input is either a photo (tesseract.js reads it directly) or a PDF
// (pdf.js reads each page's text layer, falling back to OCR for scanned
// pages). Everything else (ReceiptScanner stages, the backend parser, the
// review table) only ever sees "receipt file in, raw text out", so swapping
// engines for AWS Textract AnalyzeExpense / Mindee / Taggun / Google Vision
// later means replacing the body below and nothing else.
//
// v1 runs entirely in the browser: the photo or PDF is never sent to a
// third party for recognition, and the first OCR run downloads the English
// trained-data (~15 MB) from the CDN and caches it in the browser.
import Tesseract from "tesseract.js";
import { extractPdfText } from "./pdfText.js";

const LANG = "eng";

const makeAbortError = () => {
  const error = new Error("Receipt scan aborted");
  error.name = "AbortError";
  return error;
};

// Used by the caller to tell "user pressed Cancel / closed the modal" apart
// from a real failure — the former must not toast or reset the stage.
export const isAbortError = (error) =>
  Boolean(error) &&
  (error.name === "AbortError" ||
    error.name === "CanceledError" ||
    error.code === "ERR_CANCELED");

export const isPdfFile = (file) =>
  Boolean(file) &&
  (file.type === "application/pdf" || /\.pdf$/i.test(file.name || ""));

export async function recognizeReceipt(file, { onProgress, signal } = {}) {
  if (!file) {
    throw new Error("No receipt file to scan");
  }
  if (signal && signal.aborted) throw makeAbortError();

  return isPdfFile(file)
    ? recognizePdf(file, { onProgress, signal })
    : recognizeImage(file, { onProgress, signal });
}

// ---- photos: tesseract.js --------------------------------------------------

async function recognizeImage(file, { onProgress, signal } = {}) {
  // createWorker instead of the one-shot Tesseract.recognize() helper: that
  // helper keeps the worker handle to itself, so there would be no way to
  // terminate the WASM worker when the user cancels or the modal unmounts.
  const worker = await Tesseract.createWorker(LANG, 1, {
    logger: (message) => {
      if (typeof onProgress === "function") onProgress(message);
    },
  });

  const onAbort = () => {
    // terminate() is the only cancellation tesseract.js exposes; the pending
    // recognize() promise then settles with an error that we re-map below.
    worker.terminate().catch(() => {
      // worker already dead — nothing to clean up
    });
  };
  if (signal) signal.addEventListener("abort", onAbort, { once: true });

  try {
    if (signal && signal.aborted) throw makeAbortError();
    const result = await worker.recognize(file);
    if (signal && signal.aborted) throw makeAbortError();
    return String((result && result.data && result.data.text) || "").trim();
  } catch (error) {
    if (signal && signal.aborted) throw makeAbortError();
    throw error;
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
    await worker.terminate().catch(() => {
      // worker already terminated above
    });
  }
}

// ---- PDFs: pdf.js text layer, OCR per scanned page -------------------------

async function recognizePdf(file, { onProgress, signal } = {}) {
  // The tesseract worker is created lazily — a text-layer PDF never pays
  // the trained-data download, and only scanned pages go through OCR.
  let worker = null;

  const onAbort = () => {
    if (worker) {
      worker.terminate().catch(() => {
        // worker already dead — nothing to clean up
      });
    }
  };
  if (signal) signal.addEventListener("abort", onAbort, { once: true });

  // Called by pdfText.js for a page whose text layer came back empty.
  const ocrPage = async (page) => {
    if (!worker) {
      worker = await Tesseract.createWorker(LANG, 1, {
        logger: (message) => {
          if (typeof onProgress === "function") onProgress(message);
        },
      });
    }

    const scale = 2; // 144 dpi — sharp enough for tesseract, small enough to stay responsive
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare the PDF page for OCR");

    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const result = await worker.recognize(canvas);
    return String((result && result.data && result.data.text) || "");
  };

  try {
    const text = await extractPdfText(file, { onProgress, signal, ocrPage });
    if (signal && signal.aborted) throw makeAbortError();
    return text;
  } catch (error) {
    if (signal && signal.aborted) throw makeAbortError();
    throw error;
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
    if (worker) {
      await worker.terminate().catch(() => {
        // worker already terminated above
      });
    }
  }
}
