// Virenprüfung für hochgeladene Dateien (PDF, Bilder, Office, ZIP, Text, Video).
// Stufe 1 (immer aktiv, ohne Fremddienst): statische Prüfung auf Schadfunktionen, über die PDFs typischerweise
// angreifen – eingebettetes JavaScript, Programmstarts (/Launch), eingebettete Dateien, Flash/RichMedia,
// Datenimport sowie versteckte Programme (Windows-/Linux-Programmdateien, Skripte in Bildern) und die
// EICAR-Testsignatur. Komprimierte PDF-Inhalte (FlateDecode, Objektströme) werden dafür entpackt, verschleierte
// Namen (z. B. /J#61vaScript) entschlüsselt.
// Stufe 2 (optional): externer Virenscanner über MALWARE_SCAN_URL (+ MALWARE_SCAN_TOKEN), z. B. ClamAV-REST.
// Antwort JSON { clean: true } bzw. { infected: true }. Ist er eingetragen, muss er „sauber“ melden.
import { inflateSync } from 'node:zlib';
import { unzipSync } from 'fflate';

export type ScanResult = { clean: true; engine: string } | { clean: false; threat: string; engine: string };

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!';
const MAX_STREAMS = 400;
const MAX_INFLATED = 40 * 1024 * 1024;

// PDF-Namen mit #xx-Kodierung zurückübersetzen (/J#61vaScript → /JavaScript).
const decodeNames = (s: string) => s.replace(/\/([A-Za-z0-9#]{2,40})/g, (m) => (m.includes('#') ? m.replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) : m));

const PDF_RULES: [RegExp, string][] = [
  [/\/(JavaScript|JS)\b/, 'PDF mit eingebettetem JavaScript'],
  [/\/Launch\b/, 'PDF startet ein Programm (/Launch)'],
  [/\/(EmbeddedFiles?|EmbeddedFile)\b/, 'PDF mit eingebetteter Datei'],
  [/\/RichMedia\b/, 'PDF mit Flash/RichMedia-Inhalt'],
  [/\/ImportData\b/, 'PDF lädt fremde Daten nach (/ImportData)'],
];

function scanText(t: string): string | null {
  if (t.includes(EICAR)) return 'EICAR-Testvirus';
  if (/This program cannot be run in DOS mode/.test(t)) return 'Versteckte Windows-Programmdatei';
  return null;
}

// E-Rechnungen (ZUGFeRD/Factur-X/XRechnung) tragen die Rechnungsdaten als eingebettete XML-Datei. Diese Ausnahme gilt
// nur, wenn ALLE eingebetteten Dateien solche Rechnungs-XML sind – JavaScript, Programmstarts usw. bleiben gesperrt.
// Rechnungsdaten als XML (Name je nach Anbieter verschieden, z. B. factur-x.xml, xrechnung.xml, invoice.xml) – XML ist reine Daten.
const EINVOICE = /^[\p{L}\p{N} ._-]{1,100}\.xml$/iu;
function onlyEInvoiceXml(texts: string[]): boolean {
  const names: string[] = [];
  for (const t of texts) for (const m of t.matchAll(/\/Type\s*\/Filespec[\s\S]{0,600}?\/(?:UF|F)\s*\(([^)]{1,120})\)/g)) names.push(m[1].replace(/\\/g, '').replace(/^\xfe\xff/, '').replace(/\x00/g, '').trim());
  for (const t of texts) for (const m of t.matchAll(/\/(?:UF|F)\s*\(([^)]{1,120})\)[\s\S]{0,300}?\/Type\s*\/Filespec/g)) names.push(m[1].replace(/\\/g, '').replace(/^\xfe\xff/, '').replace(/\x00/g, '').trim());
  return names.length > 0 && names.every((n) => EINVOICE.test(n));
}

function pdfThreat(bytes: Buffer, allowEInvoice = false): string | null {
  const raw = bytes.toString('latin1');
  const parts: string[] = [raw];
  // Komprimierte Ströme entpacken (dort verstecken sich Skripte meist).
  let total = 0, n = 0;
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) && n < MAX_STREAMS && total < MAX_INFLATED) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    n++;
    const dict = raw.slice(Math.max(0, m.index - 400), m.index);
    if (/\/FlateDecode/.test(dict)) {
      try {
        const out = inflateSync(bytes.subarray(start, end), { maxOutputLength: 8 * 1024 * 1024 });
        total += out.length;
        parts.push(out.toString('latin1'));
      } catch { /* defekter oder nicht komprimierter Strom: überspringen */ }
    }
    re.lastIndex = end + 9;
  }
  const eInvoice = allowEInvoice && onlyEInvoiceXml(parts.map(decodeNames));
  for (const p of parts) {
    const t = decodeNames(p);
    for (const [rx, label] of PDF_RULES) if (rx.test(t) && !(eInvoice && label === 'PDF mit eingebetteter Datei')) return label;
    const x = scanText(p); if (x) return x;
  }
  return null;
}

function imageThreat(bytes: Buffer): string | null {
  const t = bytes.toString('latin1');
  const x = scanText(t); if (x) return x;
  if (/<\?php|<script[\s>]|<%@|#!\/bin\/(ba)?sh/i.test(t)) return 'Bild mit verstecktem Skript';
  return null;
}

// Ausführbare Dateien und Skripte – in ZIP-Archiven und als Anhang gesperrt.
const EXEC_NAME = /\.(exe|com|scr|pif|bat|cmd|msi|msp|msc|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|cpl|jar|lnk|reg|dll|sys|gadget|application|appref-ms|scf|inf|app|dmg|pkg|deb|rpm|apk|sh)$/i;
export const blockedName = (name: string) => EXEC_NAME.test(String(name || '').trim()) || /\.(docm|xlsm|pptm|dotm|xltm)$/i.test(String(name || ''));
const isProgram = (b: Buffer) => { const h = b.subarray(0, 4).toString('hex'); return h.startsWith('4d5a') || h === '7f454c46' || ['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe'].includes(h); };

// ZIP-Container (ZIP, Office: docx/xlsx/pptx): Makros, Programme und Skripte im Inneren erkennen, Inhalte rekursiv prüfen.
function zipThreat(bytes: Buffer, depth: number, allowEInvoice: boolean): string | null {
  let files: Record<string, Uint8Array>;
  let count = 0, total = 0;
  try {
    files = unzipSync(new Uint8Array(bytes), { filter: (f) => { count++; if (count > 3000) return false; if (EXEC_NAME.test(f.name)) return true; if (f.originalSize > 40 * 1024 * 1024) return false; total += f.originalSize; return total < 200 * 1024 * 1024; } });
  } catch { return null; } // verschlüsselt/defekt: keine Aussage – Microsoft Defender bzw. Empfänger prüft weiter
  if (count > 3000) return 'Archiv mit ungewöhnlich vielen Dateien';
  for (const [name, data] of Object.entries(files)) {
    const n = name.split('/').pop() || name;
    if (EXEC_NAME.test(n)) return `Archiv enthält ausführbare Datei (${n.slice(0, 60)})`;
    if (/vbaProject\.bin$/i.test(name) || /\/vbaData\.xml$/i.test(name)) return 'Office-Dokument mit Makros';
    if (/\/(activeX|embeddings)\/.*\.(bin|exe|ole)$/i.test(name)) return 'Office-Dokument mit eingebettetem Programm/Objekt';
    const r = detectThreat(Buffer.from(data), depth + 1, allowEInvoice);
    if (r) return `${r} (in ${n.slice(0, 60)})`;
  }
  return null;
}

// Alte Office-Formate (doc/xls/ppt, OLE2): Makro-Projekt erkennen.
function oleThreat(bytes: Buffer): string | null {
  const t = bytes.toString('latin1');
  if (/_VBA_PROJECT|VBA\x00P\x00R\x00O\x00J|Attribut\x00e VB_Name|Attribute VB_Name/.test(t)) return 'Office-Dokument mit Makros';
  return scanText(t);
}

function detectThreat(bytes: Buffer, depth: number, allowEInvoice: boolean): string | null {
  if (!bytes.length) return null;
  if (isProgram(bytes)) return 'Programmdatei statt Dokument';
  const hex = bytes.subarray(0, 8).toString('hex');
  if (hex.startsWith('504b0304')) return depth < 3 ? zipThreat(bytes, depth, allowEInvoice) : 'Zu tief verschachteltes Archiv';
  if (hex === 'd0cf11e0a1b11ae1') return oleThreat(bytes);
  if (bytes.subarray(0, 1024).toString('latin1').includes('%PDF-')) return pdfThreat(bytes, allowEInvoice);
  if (/^(ffd8ff|89504e47|47494638|49492a00|4d4d002a|52494646)/.test(hex)) return imageThreat(bytes); // JPEG, PNG, GIF, TIFF, WEBP
  // Video/Audio (MP4/MOV/…): nur bekannte Signaturen
  if (bytes.subarray(4, 8).toString('latin1') === 'ftyp') return scanText(bytes.subarray(0, 4 * 1024 * 1024).toString('latin1'));
  // Text, HTML, SVG, CSV, XML: Skripte und Testsignatur
  const t = bytes.subarray(0, 8 * 1024 * 1024).toString('latin1');
  const x = scanText(t); if (x) return x;
  if (/^\s*(<\?xml[^>]*>\s*)?<(svg|html|!doctype html)/i.test(t) && /<script[\s>]|\son[a-z]+\s*=|javascript:/i.test(t)) return 'Datei mit eingebettetem Skript';
  if (/^#!\//.test(t)) return 'Skriptdatei';
  return null;
}

// Statische Prüfung (synchron, ohne Netz) für jeden Dateityp: Programme, Makros, Skripte, verdächtige PDF-Funktionen,
// ZIP-/Office-Inhalte (rekursiv) und die EICAR-Testsignatur.
// allowEInvoice: nur für Rechnungen (Beleg-Postfach/Steuer), damit E-Rechnungen nicht abgelehnt werden.
export function staticScan(bytes: Buffer, o: { allowEInvoice?: boolean } = {}): ScanResult {
  const engine = 'leaserun-static-2';
  const threat = detectThreat(bytes, 0, o.allowEInvoice === true);
  return threat ? { clean: false, threat, engine } : { clean: true, engine };
}

// Vollständige Prüfung: statisch + (falls eingetragen) externer Scanner.
export async function scanUpload(bytes: Buffer): Promise<ScanResult> {
  const s = staticScan(bytes);
  if (!s.clean) return s;
  const url = process.env.MALWARE_SCAN_URL;
  if (!url) return s;
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...(process.env.MALWARE_SCAN_TOKEN ? { Authorization: `Bearer ${process.env.MALWARE_SCAN_TOKEN}` } : {}) }, body: new Uint8Array(bytes), signal: AbortSignal.timeout(20000) });
    const j = (await r.json().catch(() => ({}))) as { clean?: boolean; infected?: boolean; virus?: string };
    if (r.ok && (j.infected === true || j.clean === false)) return { clean: false, threat: j.virus ? `Virus erkannt: ${String(j.virus).slice(0, 80)}` : 'Virus erkannt', engine: 'extern' };
    if (r.ok && j.clean === true) return { clean: true, engine: 'leaserun-static-1+extern' };
    // Scanner nicht erreichbar: lieber ablehnen als ungeprüft speichern.
    return { clean: false, threat: 'Virenprüfung gerade nicht möglich – bitte später erneut hochladen', engine: 'extern' };
  } catch {
    return { clean: false, threat: 'Virenprüfung gerade nicht möglich – bitte später erneut hochladen', engine: 'extern' };
  }
}

export const threatMessage = (r: ScanResult) => (r.clean ? '' : `Die Datei wurde aus Sicherheitsgründen abgelehnt (${r.threat}). Bitte eine normale Datei hochladen – z. B. neu als PDF drucken/speichern.`);
