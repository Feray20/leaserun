# LeaseRun

Website for **LeaseRun** — turnkey US rental acquisitions, full-service property management and 1031 exchange coordination for real estate investors.

**Live:** https://leaserun.vercel.app

## Structure

```
site/                      Static website (deployed on Vercel, root directory = site)
  build.py                 Builds the 4 main pages into dist/ (shared header/footer, content)
  extra.py                 Privacy, Terms, 404, /admin lead dashboard, iPhone icon, sitemap, robots
  finalize.py              Launch-readiness pass (labels sample data, removes placeholders)
  app.js                   ROI calculator, lead modal, property filters, form → Supabase
  styles.css               Design system (brand colors from the logo)
  vercel.json              Build command + clean URLs
supabase/
  migrations/              `leads` table with row-level security (public insert-only)
  functions/leads-admin/   Password-protected API behind /admin (list + status update)
docs/
  funnel-copy.md           Lead-capture funnel: emails, deal-sheet opt-in, intake forms
  logo-original.jpg        Original brand logo
```

## Build locally

Python 3 only, no dependencies:

```bash
cd site
python3 build.py && python3 extra.py && python3 finalize.py
python3 -m http.server -d dist 8000   # open http://localhost:8000
```

## Pages

| Route | Purpose |
|---|---|
| `/` | Hero + live underwriting calculator, how it works, pillars, tax benefits, FAQ |
| `/properties` | Filterable sample deals (state, price, cap rate, cash-on-cash, type) |
| `/property-management` | Pricing tiers, guarantees, tenant screening |
| `/about-contact` | Company, compliance, portfolio-audit intake form |
| `/privacy`, `/terms` | Legal |
| `/admin` | Lead dashboard (noindex, password-protected) |

## Leads (Supabase project `leaserun`)

- Every form writes to `public.leads` via the publishable key. RLS allows **insert only** — the public API cannot read, update or delete leads.
- `/admin` talks to the `leads-admin` Edge Function, which checks the password stored in the Edge Function secret **`LEASERUN_ADMIN_PASSWORD`** (min. 8 characters) and uses the service role server-side.
- Set or change the password: Supabase Dashboard → Edge Functions → Secrets.

## Before going fully live

- Replace sample deals in `site/build.py` (`LISTINGS`) with real inventory.
- Add real license numbers and contact details once available.
- Connect the custom domain in Vercel and set up the `invest@leaserun.com` mailbox.
