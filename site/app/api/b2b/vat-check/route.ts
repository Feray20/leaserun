import { json, requireMember } from '@/lib/b2b/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// EIN format check for the own business (US replacement for the former EU VAT/VIES check).
// There is no free public IRS API to verify an EIN against a business name, so this checks the format and the
// IRS campus prefix only. The EIN is optional; the result is not stored. Route path kept for compatibility.
const EIN_RE = /^([0-9]{2})-?([0-9]{7})$/;
// Valid EIN prefixes as assigned by the IRS (07, 08, 09, 17, 18, 19, 28, 29, 49, 69, 70, 78, 79, 89, 96, 97 and 00 are not issued).
const VALID_PREFIX = new Set([
  '01', '02', '03', '04', '05', '06', '10', '11', '12', '13', '14', '15', '16', '20', '21', '22', '23', '24', '25', '26', '27',
  '30', '31', '32', '33', '34', '35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47', '48', '50', '51', '52',
  '53', '54', '55', '56', '57', '58', '59', '60', '61', '62', '63', '64', '65', '66', '67', '68', '71', '72', '73', '74', '75', '76',
  '77', '80', '81', '82', '83', '84', '85', '86', '87', '88', '90', '91', '92', '93', '94', '95', '98', '99',
]);

export async function POST(req: Request) {
  const ctx = await requireMember(req, { bucket: 'b2b-vat', limit: 10 });
  if (ctx instanceof Response) return ctx;
  const raw = String(ctx.account.tax_id || '').replace(/\s+/g, '');
  const m = EIN_RE.exec(raw);
  if (!m) return json({ checked: false, error: 'No EIN on file (format 12-3456789). The EIN is optional – add it in your company profile if you want it on invoices.' }, 400);
  const ein = `${m[1]}-${m[2]}`;
  return json({ checked: true, valid: VALID_PREFIX.has(m[1]), vatId: ein, name: null, at: new Date().toISOString(), method: 'format' });
}
