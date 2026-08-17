/**
 * Reading uploaded documents entirely in the browser. Nothing is sent anywhere
 * except, later, to the extraction API the learner has chosen.
 *
 * pdf.js and mammoth are vendored rather than pulled from a CDN so the site
 * keeps working on any static host, offline, and forever — no third party can
 * take a version down underneath it. The vendored pdf.js is the *legacy* build:
 * the modern one calls Promise.withResolvers, which older Safari lacks, and it
 * failed on iPhones with an unhelpful "undefined is not a function".
 */

import './polyfills.js';

const MAX_PAGES = 100;
const MAX_CHARS = 90000;

/** Below this many characters per page, the PDF is almost certainly a scan. */
const THIN_PAGE_THRESHOLD = 90;

let pdfjsPromise = null;
let mammothPromise = null;

async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('../vendor/pdf.min.mjs').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

async function loadMammoth() {
  if (!mammothPromise) {
    mammothPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('../vendor/mammoth.browser.min.js', import.meta.url).href;
      script.onload = () => resolve(window.mammoth);
      script.onerror = () => reject(new Error('Could not load the Word document reader.'));
      document.head.append(script);
    });
  }
  return mammothPromise;
}

/**
 * pdf.js hands back positioned text fragments, not lines. Rebuild lines by
 * watching for vertical movement, so tables and bullet lists survive as
 * something the model can still read.
 */
function itemsToText(items) {
  let text = '';
  let lastY = null;

  for (const item of items) {
    if (!item.str) {
      if (item.hasEOL) text += '\n';
      continue;
    }

    const y = item.transform ? item.transform[5] : null;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
      text += '\n';
    } else if (text && !text.endsWith(' ') && !text.endsWith('\n')) {
      text += ' ';
    }

    text += item.str;
    if (item.hasEOL) text += '\n';
    lastY = y;
  }

  return text;
}

async function readPdf(buffer) {
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const doc = await loadingTask.promise;

  const totalPages = doc.numPages;
  const pagesToRead = Math.min(totalPages, MAX_PAGES);
  const chunks = [];

  for (let i = 1; i <= pagesToRead; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    chunks.push(`--- page ${i} ---\n${itemsToText(content.items).trim()}`);
    page.cleanup();
  }

  const text = chunks.join('\n\n');
  // Release the worker's copy of the file; the loading task owns that, not the
  // document proxy.
  await loadingTask.destroy();

  return {
    kind: 'pdf',
    text,
    totalPages,
    pagesRead: pagesToRead,
    truncated: totalPages > MAX_PAGES,
    needsVision: text.length / Math.max(1, pagesToRead) < THIN_PAGE_THRESHOLD,
  };
}

async function readDocx(buffer) {
  const mammoth = await loadMammoth();
  const { value } = await mammoth.extractRawText({ arrayBuffer: buffer });
  return {
    kind: 'docx',
    text: (value || '').trim(),
    totalPages: 0,
    pagesRead: 0,
    truncated: false,
    needsVision: false,
  };
}

function readPlainText(buffer) {
  return {
    kind: 'text',
    text: new TextDecoder().decode(buffer).trim(),
    totalPages: 0,
    pagesRead: 0,
    truncated: false,
    needsVision: false,
  };
}

/** Bigger than this and sending the raw file for reading is not realistic. */
const MAX_RAW_PDF_BYTES = 18 * 1024 * 1024;

export async function readDocument(file) {
  const name = (file.name || '').toLowerCase();
  const type = file.type || '';
  const buffer = await file.arrayBuffer();

  let result;
  if (type === 'application/pdf' || name.endsWith('.pdf')) {
    try {
      result = await readPdf(buffer);
    } catch (error) {
      // The in-browser PDF reader is the fast, cheap path, not the only one.
      // Rather than dead-ending on a browser it cannot run in, hand the file
      // over to be read visually instead — slower and more tokens, but it
      // works everywhere.
      if (buffer.byteLength > MAX_RAW_PDF_BYTES) {
        throw new Error(
          'This browser could not read that PDF, and the file is too large to send for reading as-is. Try it in Chrome on a computer, or split the document up.'
        );
      }

      console.warn('[lekgotla] in-browser PDF reading failed, falling back:', error);
      result = {
        kind: 'pdf',
        text: '',
        totalPages: 0,
        pagesRead: 0,
        truncated: false,
        needsVision: true,
        fallbackReason: error && error.message ? error.message : String(error),
      };
    }
  } else if (name.endsWith('.docx') || type.includes('wordprocessingml')) {
    result = await readDocx(buffer);
  } else if (name.endsWith('.txt') || name.endsWith('.md') || type.startsWith('text/')) {
    result = readPlainText(buffer);
  } else {
    throw new Error('That file type is not supported. Use a PDF, a Word .docx, or a plain .txt file.');
  }

  if (result.text.length > MAX_CHARS) {
    result.text = result.text.slice(0, MAX_CHARS);
    result.truncated = true;
  }

  if (!result.text && !result.needsVision) {
    throw new Error('No readable text was found in that file. If it is a scan, try a clearer copy.');
  }

  result.filename = file.name;
  result.buffer = buffer;
  return result;
}
