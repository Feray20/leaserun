// Definierte Testdaten für Sandbox, Playground und End-to-End-Test. Fiktiv, eindeutig als TEST markiert.
import type { CaseData } from '@/lib/api/schemas';

export const TEST_CASE: CaseData = {
  external_reference: 'TEST-0001',
  customer: { first_name: 'Test', last_name: 'Person (TEST)', email: 'test.person@example.com', phone: '+49 000 0000000' },
  applicants: [{ first_name: 'Test', last_name: 'Person (TEST)', employment_type: 'employed', employed_since: '2018-04-01', monthly_net_income: 6000 }],
  property: {
    property_type: 'apartment', usage: 'owner_occupied',
    address: { street: 'Teststraße 1 (TEST)', postal_code: '64354', city: 'Reinheim', state: 'hessen' },
    purchase_price: 450000, land_value: 90000, renovation_cost: 0, living_area: 92, year_built: 2004,
  },
  household: { monthly_net_income: 6000, monthly_expenses: 2200, adults: 1, dependants: 0 },
  equity: { amount: 100000, available_amount: 100000 },
  loan: { requested_amount: 350000, term_years: 30, repayment_rate: 2, interest_rate: 3.8 },
  metadata: { source: 'leaserun-sandbox', test: true },
};

// Minimales, gültiges PDF (eine leere Seite) als Testunterlage – Dateisignatur %PDF- ist echt.
export function testPdf(label = 'TEST-UNTERLAGE'): Buffer {
  const text = `BT /F1 18 Tf 72 720 Td (${label.replace(/[()\\]/g, '')} - LeaseRun Sandbox, keine Echtdaten) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
