// Hochladen großer Dateien direkt zu Microsoft OneDrive (Hochladesitzung, Teile à 10 MB, je Teil bis zu 4 Versuche).
// Die Adresse ist vorab berechtigt: kein Anmeldetoken im Browser, die Datei läuft nicht über den LeaseRun-Server.
const PART = 32 * 327680; // 10 MiB, Vielfaches von 320 KiB (Vorgabe von Microsoft)
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function sendFile(file, uploadUrl, onProgress = () => {}, signal) {
  const total = file.size;
  let start = 0;
  while (start < total) {
    const end = Math.min(start + PART, total);
    let ok = false, res = null;
    for (let t = 0; t < 4 && !ok; t++) {
      if (signal?.aborted) throw new Error('Abgebrochen.');
      try {
        res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Range': `bytes ${start}-${end - 1}/${total}` }, body: file.slice(start, end), signal });
        ok = res.ok || res.status === 202;
        if (!ok && res.status < 500 && res.status !== 429) break;
      } catch (e) { if (signal?.aborted) throw e; }
      if (!ok) await wait(1500 * (t + 1));
    }
    if (!ok) throw new Error('Übertragung unterbrochen. Bitte erneut versuchen.');
    // Microsoft nennt den nächsten erwarteten Bereich – daran ausrichten (falls ein Teil schon angekommen war).
    if (res.status === 202) {
      const j = await res.json().catch(() => ({}));
      const next = Number(String(j.nextExpectedRanges?.[0] || '').split('-')[0]);
      start = Number.isFinite(next) && next > start ? next : end;
    } else start = end;
    onProgress(Math.min(start, total) / total);
  }
}

export const size = (b) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB` : b >= 1024 ** 2 ? `${Math.max(1, Math.round(b / 1024 ** 2))} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
