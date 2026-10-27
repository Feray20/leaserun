// PDF-Ansicht: Ergebnis erscheint zuerst auf dem Bildschirm (alle Seiten, mit pdf.js gerendert –
// funktioniert auch auf dem iPhone), danach Herunterladen oder Teilen.
const PDFJS = '/vendor/pdfjs-4.10.38/';
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function showPdf(blob, { filename = 'LeaseRun.pdf', title = 'Ihr Dokument', note = '', onClose } = {}) {
  document.querySelector('.ia-pdfv')?.remove();
  const url = URL.createObjectURL(blob);
  const el = document.createElement('div');
  el.className = 'lr-pdfv';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', title);
  const canShare = (() => { try { return !!(navigator.canShare && navigator.canShare({ files: [new File([blob], filename, { type: 'application/pdf' })] })); } catch { return false; } })();
  el.innerHTML = `<div class="lr-pdfv-bar"><div class="lr-pdfv-t"><strong>${esc(title)}</strong><small>${esc(filename)}</small></div>
    <button type="button" class="lr-pdfv-x" aria-label="Schließen">✕</button></div>
    ${note ? `<p class="lr-pdfv-note">${note}</p>` : ''}
    <div class="lr-pdfv-pages" tabindex="0"><p class="lr-pdfv-load">Dokument wird angezeigt …</p></div>
    <div class="lr-pdfv-act"><a class="btn btn-dark" href="${url}" download="${esc(filename)}">PDF herunterladen</a>${canShare ? '<button type="button" class="btn btn-outline" data-share>Teilen</button>' : ''}<button type="button" class="btn btn-ghost" data-close>Schließen</button></div>`;
  document.body.appendChild(el);
  document.body.classList.add('lr-pdfv-open');
  // Zurück-Taste (Browser/Wischgeste) schließt die Ansicht, statt die Seite zu verlassen.
  let done = false;
  const finish = () => { if (done) return; done = true; el.remove(); document.body.classList.remove('lr-pdfv-open'); setTimeout(() => URL.revokeObjectURL(url), 60_000); onClose?.(); document.removeEventListener('keydown', key); removeEventListener('popstate', pop); };
  const pop = () => finish();
  try { history.pushState({ iaPdfv: 1 }, '', location.href); addEventListener('popstate', pop); } catch { /* ignore */ }
  const close = () => { if (done) return; if (history.state && history.state.iaPdfv) history.back(); else finish(); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  el.querySelector('.ia-pdfv-x').onclick = close;
  el.querySelector('[data-close]').onclick = close;
  el.querySelector('[data-share]')?.addEventListener('click', async () => {
    try { await navigator.share({ files: [new File([blob], filename, { type: 'application/pdf' })], title }); } catch { /* abgebrochen */ }
  });
  el.querySelector('.ia-pdfv-x').focus();

  const box = el.querySelector('.ia-pdfv-pages');
  try {
    const pdfjs = await import(PDFJS + 'pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.mjs';
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
    box.innerHTML = '';
    const width = Math.min(box.clientWidth || 360, 900) - 8;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (let i = 1; i <= Math.min(doc.numPages, 40); i++) {
      if (!el.isConnected) break;
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: (width / base.width) * dpr });
      const c = document.createElement('canvas');
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      c.style.width = `${Math.floor(vp.width / dpr)}px`; c.style.height = `${Math.floor(vp.height / dpr)}px`;
      c.setAttribute('aria-label', `Seite ${i} von ${doc.numPages}`);
      box.appendChild(c);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp, annotationMode: pdfjs.AnnotationMode?.ENABLE_FORMS ?? 2 }).promise;
    }
    await doc.destroy();
  } catch (e) {
    console.warn(e);
    box.innerHTML = '<p class="lr-pdfv-load">Die Vorschau kann hier nicht angezeigt werden. Bitte über „PDF herunterladen“ öffnen.</p>';
  }
  return { close };
}

// Formularfelder eines PDFs auslesen (AcroForm), z. B. nach dem Wiedereinlesen eines ausgefüllten LeaseRun-Formulars.
export async function readPdfForm(file) {
  const pdfjs = await import(PDFJS + 'pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.mjs';
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  try {
    const meta = await doc.getMetadata().catch(() => null);
    const info = meta?.info || {};
    const objs = (await doc.getFieldObjects()) || {};
    const values = {};
    for (const [name, arr] of Object.entries(objs)) {
      const f = Array.isArray(arr) ? arr[0] : arr;
      if (!f) continue;
      let v = f.value;
      if (f.type === 'checkbox') v = v && v !== 'Off';
      values[name] = v;
    }
    return { id: String(info.Subject || ''), keywords: String(info.Keywords || ''), values };
  } finally { await doc.destroy(); }
}
