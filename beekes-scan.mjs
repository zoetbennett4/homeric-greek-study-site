import {getDocument, GlobalWorkerOptions} from './pdfjs/pdf.min.mjs';

GlobalWorkerOptions.workerSrc = new URL('./pdfjs/pdf.worker.min.mjs', import.meta.url).href;
const wasmUrl = new URL('./pdfjs/wasm/', import.meta.url).href;
const documents = new Map();

function openDocument(path) {
  const url = window.STUDY_ACCESS?.asset?.(path) || path;
  const current = documents.get(path);
  if (current?.url === url) return current.task.promise;

  current?.task.destroy().catch(() => {});
  const task = getDocument({url, wasmUrl, rangeChunkSize: 262144, disableAutoFetch: true, disableStream: true});
  documents.set(path, {url, task});
  task.promise.catch(() => {
    if (documents.get(path)?.task === task) documents.delete(path);
    return task.destroy().catch(() => {});
  });
  return task.promise;
}

function pageHalf(spread, x, width) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = spread.height;
  canvas.getContext('2d').drawImage(spread, x, 0, width, spread.height, 0, 0, width, spread.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create page image')));
  });
}

class BeekesScan extends HTMLElement {
  #load;
  #images = [];

  async connectedCallback() {
    const {pdf, page} = this.dataset;
    const status = this.querySelector('[role="status"]');
    if (!status || !/^library-originals\/beekes-edg\/part0[12]\.pdf$/.test(pdf) || !/^[1-9]\d*$/.test(page)) return;

    const load = new AbortController();
    this.#load = load;
    const {signal} = load;
    status.textContent = 'Loading printed page…';

    try {
      const pdfDocument = await openDocument(pdf);
      if (signal.aborted) return;
      const source = await pdfDocument.getPage(Number(page));
      if (signal.aborted) return;

      const viewport = source.getViewport({scale: 2.4});
      const spread = document.createElement('canvas');
      spread.width = Math.ceil(viewport.width);
      spread.height = Math.ceil(viewport.height);
      const render = source.render({canvas: spread, viewport});
      signal.addEventListener('abort', () => render.cancel(), {once: true});
      await render.promise;
      if (signal.aborted) return;

      const middle = Math.floor(spread.width / 2);
      const halves = await Promise.all([
        pageHalf(spread, 0, middle),
        pageHalf(spread, middle, spread.width - middle),
      ]);
      if (signal.aborted) return;

      const pages = document.createElement('div');
      pages.className = 'dictionary-spread';
      for (const [i, blob] of halves.entries()) {
        const side = i === 0 ? 'left' : 'right';
        const url = URL.createObjectURL(blob);
        this.#images.push(url);
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.title = 'Enlarge ' + side + ' page';
        link.setAttribute('aria-label', link.title + ' in a new tab');
        const img = document.createElement('img');
        img.src = url;
        img.alt = (i === 0 ? 'Left' : 'Right') + ' printed page';
        img.width = i === 0 ? middle : spread.width - middle;
        img.height = spread.height;
        link.append(img);
        pages.append(link);
      }
      status.hidden = true;
      this.append(pages);
    } catch {
      if (!signal.aborted) status.textContent = 'The scan could not load here. Use Open PDF to view this spread.';
    }
  }

  disconnectedCallback() {
    this.#load?.abort();
    for (const url of this.#images) URL.revokeObjectURL(url);
    this.#images = [];
    this.querySelector('.dictionary-spread')?.remove();
    const status = this.querySelector('[role="status"]');
    if (status) status.hidden = false;
  }
}

customElements.define('beekes-scan', BeekesScan);
