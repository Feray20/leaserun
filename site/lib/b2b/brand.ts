import { supabaseAdmin } from '@/lib/supabase/admin';
import type { PartnerBrand } from '@/lib/pdf/brand';
import { canCobrand, type B2BAccount } from '@/lib/b2b/core';

// Co-Branding für PDFs: Firmenname, Logo (als Data-URL) und Farbe – nur mit Berechtigung (Pro/Enterprise oder freigeschaltet).
export async function partnerBrandFor(a: B2BAccount | null | undefined): Promise<PartnerBrand | null> {
  if (!a || a.status !== 'active' || !canCobrand(a)) return null;
  let logo: string | null = null;
  if (a.logo_path) {
    const dl = await supabaseAdmin().storage.from('b2b-logos').download(a.logo_path);
    if (!dl.error && dl.data) {
      const buf = Buffer.from(await dl.data.arrayBuffer());
      const type = buf[0] === 0x89 ? 'image/png' : buf[0] === 0xff ? 'image/jpeg' : null;
      if (type) logo = `data:${type};base64,${buf.toString('base64')}`;
    }
  }
  return { name: a.company_name, logo, color: a.brand_color, whitelabel: Boolean(a.has_whitelabel) };
}
