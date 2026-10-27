// Upload large files directly to Microsoft OneDrive (upload session, 10 MB chunks, up to 4 attempts per chunk).
// The address is pre-authorized: no sign-in token in the browser, the file doesn't go through the LeaseRun server.
const PART = 32 * 327680; // 10 MiB, a multiple of 320 KiB (Microsoft requirement)
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function sendFile(file, uploadUrl, onProgress = () => {}, signal) {
  const total = file.size;
  let start = 0;
  while (start < total) {
    const end = Math.min(start + PART, total);
    let ok = false, res = null;
    for (let t = 0; t < 4 && !ok; t++) {
      if (signal?.aborted) throw new Error('Canceled.');
      try {
        res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Range': `bytes ${start}-${end - 1}/${total}` }, body: file.slice(start, end), signal });
        ok = res.ok || res.status === 202;
        if (!ok && res.status < 500 && res.status !== 429) break;
      } catch (e) { if (signal?.aborted) throw e; }
      if (!ok) await wait(1500 * (t + 1));
    }
    if (!ok) throw new Error('Upload interrupted. Please try again.');
    // Microsoft reports the next expected range – follow it (in case a chunk had already arrived).
    if (res.status === 202) {
      const j = await res.json().catch(() => ({}));
      const next = Number(String(j.nextExpectedRanges?.[0] || '').split('-')[0]);
      start = Number.isFinite(next) && next > start ? next : end;
    } else start = end;
    onProgress(Math.min(start, total) / total);
  }
}

export const size = (b) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toLocaleString('en-US', { maximumFractionDigits: 1 })} GB` : b >= 1024 ** 2 ? `${Math.max(1, Math.round(b / 1024 ** 2))} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
