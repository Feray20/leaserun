# LeaseRun

Website for **LeaseRun** — turnkey US rental acquisitions, full-service property management and 1031 exchange coordination for real estate investors.

**Live:** https://leaserun.com (also https://leaserun.vercel.app)

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

## Investor software (US version of ImmoAdv)

Added on top of the company site; existing pages are unchanged apart from extra nav links and one teaser section on the home page.

| Route | Purpose |
|---|---|
| `/start` | Guided first-rental walk-through in 3 steps with glossary (public) |
| `/analyzer` | Full deal analyzer: closing costs, PITIA, cash flow, cap rate, CoC, DSCR, red flags, stress test, 10-year projection, federal tax (public) |
| `/pricing` | Free · Lender Package $39 · Buyer Pass $49/90 days · Investor Pro $29/mo (waitlist until checkout is live) |
| `/sample-loan-package` | Lender package with fictional numbers |
| `/login`, `/signup`, `/forgot`, `/reset` | Supabase Auth (email + password) |
| `/app` | Dashboard: beginner purchase path or pro portfolio KPIs, saved properties, tools |
| `/app/property`, `/app/profile`, `/app/tools`, `/app/loan-package` | Property workspace, investor profile (incl. data export), 9 tools with charts (tiered), printable lender package |
| `/calculators` | Hub of all free calculators |
| `/deadlines` | Contingency, Closing Disclosure (TRID business days), first payment and 1031 45/180-day dates, .ics export |
| `/scenarios` | Sell vs. 1031 vs. cash-out refinance vs. keep, with recapture and NIIT |
| `/checklist`, `/profiler` | Loan document checklist; six-question strategy profiler |
| `/learn`, `/learn/*` | Knowledge center (31 articles, `site/learn_content.py`) with search |
| `/business` | LeaseRun for Business: Basic $79, Pro $149, Enterprise custom |
| `/business/portal` | Business portal: pipeline, client files, client analyses, branded lender packages, advisor playbook, company profile |

Files: `site/lr-calc.js` (pure US underwriting engine, tested in `tests/calc.test.js` → `node --test tests/calc.test.js`; build: `python3 build.py && python3 extra.py && python3 software.py && python3 finalize.py`), `site/lr-app.js` (UI, talks to Supabase REST directly), `site/lr-app.css`, `site/software.py` (adds the pages during the build).

Database: `supabase/migrations/20261017120000_investor_app.sql` and `20261018090000_business.sql` (business_profiles, clients, properties.client_id; Basic limited to 25 active clients) – `entitlements` (read-only for users, written by billing), `financial_profiles`, `properties`; RLS owner-only; free plan limited to 2 properties by trigger.

Supabase Auth settings: Site URL `https://leaserun.com`, redirect URLs `https://leaserun.com/**` and `https://leaserun.vercel.app/**`.
