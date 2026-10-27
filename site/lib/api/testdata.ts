// Defined test data for sandbox, playground and end-to-end test. Fictitious, clearly marked as TEST.
import type { CaseData } from '@/lib/api/schemas';

export const TEST_CASE: CaseData = {
  external_reference: 'TEST-0001',
  customer: { first_name: 'Test', last_name: 'Person (TEST)', email: 'test.person@example.com', phone: '+1 555 010 0000' },
  applicants: [{ first_name: 'Test', last_name: 'Person (TEST)', employment_type: 'employed', employed_since: '2018-04-01', monthly_gross_income: 10000, monthly_net_income: 7400 }],
  property: {
    property_type: 'apartment', usage: 'owner_occupied',
    address: { street: '100 Test St Unit 1 (TEST)', postal_code: '78701', city: 'Austin', state: 'TX' },
    purchase_price: 450000, land_value: 90000, renovation_cost: 0, closing_costs: 13500, annual_property_tax: 8100, annual_insurance: 1800, monthly_hoa: 250, living_area: 990, year_built: 2004,
  },
  household: { monthly_gross_income: 10000, monthly_net_income: 7400, monthly_debt_payments: 450, monthly_expenses: 2200, adults: 1, dependants: 0 },
  equity: { amount: 100000, available_amount: 100000 },
  loan: { requested_amount: 350000, term_years: 30, interest_rate: 6.5, loan_program: 'conventional' },
  metadata: { source: 'leaserun-sandbox', test: true },
};

// Minimal valid PDF (one page) as a test document – the %PDF- file signature is real.
export function testPdf(label = 'TEST-DOCUMENT'): Buffer {
  const text = `BT /F1 18 Tf 72 720 Td (${label.replace(/[()\\]/g, '')} - LeaseRun Sandbox, no real data) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
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
