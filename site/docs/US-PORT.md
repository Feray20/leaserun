# LeaseRun = ImmoAdv for the US market (porting guide)

LeaseRun (leaserun.com) is the exact US twin of ImmoAdv (immoadv.de): same features, same look ("fade" gradient
style, same components, same flows, same Web-Admin / Headquarters), but in **American English**, with **US real
estate, lending, tax and legal logic**, prices in **USD**, and **no dropshipping / Steuersoftware** (removed).
The codebase in `site/` is a copy of ImmoAdv, already rebranded (ImmoAdv → LeaseRun, immoadv.de → leaserun.com,
table prefix `immo_` → `lr_`, storage keys `ia-` → `lr-`) and with public URLs renamed to English (see route map).

## Hard rules for every change
1. Everything a user, customer, partner or the owner sees must be **natural American English** (UI text, emails,
   PDFs, error messages returned by APIs, alt texts, titles, meta descriptions, JSON-LD, aria labels). Code comments
   may be translated to English too (preferred), but correctness of code comes first.
2. Keep the feature set and UX **1:1** with ImmoAdv. Do not drop features, do not simplify flows, do not rebuild
   working components. Translate and adapt. Exception: things that only exist because of German law/market are
   replaced by the US equivalent (table below). Dropshipping/eBay/Amazon/Steuersoftware is removed entirely.
3. Do **not** rename: API route folders under `app/api/**`, database tables/columns, storage bucket names, function
   names, file names of modules. (A mechanical pass may do that later.) Public page URLs are already English.
4. Do **not** run git commands. Do not touch files outside your assigned area; if a change is needed elsewhere,
   list it in your final report under "Needed in other areas".
5. No secrets in client code. Keep all security checks (RLS assumptions, role checks, rate limits, CSP) intact.
6. The public website must show **no signs of AI** to end customers (no "AI-generated", no robot wording). Internal
   Web-Admin/Headquarters may talk about agents.
7. Owner privacy: never show the owner's residence/German address anywhere public. Her name only where ImmoAdv
   shows it on the about page (title "Head of Operations"), not in company emails, footers or PDFs. Company
   contact: **support@leaserun.com**. Operator name: "LeaseRun". Her title in the Web-Admin is "Head of Operations".
8. Legal: if something is legally unclear in the US (consumer finance, lending, licensing, money transmission,
   card issuing, TCPA for calls/SMS, CAN-SPAM, state privacy laws, fair housing), choose the lowest-risk variant
   (disable or label "coming soon", add the needed disclaimer once — not repeatedly) and list it under "Legal flags".
   LeaseRun is software for education and planning: **not** a lender, broker, advisor or appraiser.
9. Formatting: `en-US` locale, `$1,234.56`, dates `Oct 27, 2026` / `10/27/2026`, square feet, miles, imperial.
   Replace `toLocaleString('de-DE')`, `Intl.NumberFormat('de-DE', … 'EUR')`, `,`-decimal parsing etc. Inputs must
   accept `1,234.56` and `1234.56`.
10. Keep standing owner wishes: back button returns to the exact place; statistics always show today's date;
   disclaimers once, not repeated; smooth (120 Hz feel), no loading jank; works on iPhone Safari, Android Chrome,
   desktop; paywall is server-side (free = general info / demo, paid = full tools, ~20% previews of PDFs/examples);
   B2C, Business and Web-Admin logins strictly separate; internal Web-Admin logs collapsed by default; HQ proposals
   only "Do it" / "Dismiss".

## Route map (already applied to public/ and links)
| ImmoAdv | LeaseRun |
|---|---|
| /wissen | /learn |
| /ratgeber | /guides |
| /rechner | /calculators |
| /rechner/kaufnebenkosten/<land> | /calculators/closing-costs/<state-slug> (50 states + DC) |
| /rechner/afa · budget · cashflow · kaufen-mieten · mieterhoehung · scorecard · tilgungsplan · vergleich · bank-chancen-checker | /calculators/depreciation · budget · cash-flow · rent-vs-buy · rent-increase · scorecard · amortization · loan-comparison · approval-odds |
| / (product landing) | /software (the LeaseRun company home stays at /) |
| /angebote | /pricing |
| /kasse | /checkout |
| /kuendigen | /cancel |
| /widerrufen | /refund |
| /mustermappe | /sample-loan-package |
| /pro-begleiter · /checkliste · /lernpfad | /pro-guide · /checklist · /learning-path |
| /fristen · /szenarien · /profiler · /start · /suche | /deadlines · /scenarios · /profiler · /start · /search |
| /pruefen (+ /verify/:id) | /review (+ /verify/:id) |
| /datenraum · /datei · /termin · /anfrage | /data-room · /files · /book · /request |
| /b2b · /b2b-portal | /business · /business-portal |
| /creator · /creator-kit · /partner (+ /p/:slug) · /karten (/konto, /preise) | /creators · /creator-kit · /partners · /card (/account, /pricing) |
| /ueber-uns · /kontakt · /sicherheit | /about · /contact · /security |
| /datenschutz · /nutzungsbedingungen · /impressum | /privacy · /terms · /legal-notice (US: no Impressum; page becomes a short "Company information" page or redirects to /about) |
| /intern/web-admin | /internal/web-admin |
| /auth/login · /auth/register | unchanged (/login, /signup redirect there) |
| LeaseRun company pages | / · /properties · /property-management · /about-contact (built from `legacy/build.py`, content must stay) |

## Glossary (German concept → US equivalent)
- Kreditmappe → **Lender Package** (bank-ready PDF: sources & uses, PITIA, DSCR, reserves, rent roll, stress test, document checklist, QR verification)
- Objekt / Immobilie → property · Exposé → listing · Finanzprofil / Selbstauskunft / Haushaltsrechnung → financial profile / personal financial statement / monthly budget
- Kaufnebenkosten (Grunderwerbsteuer, Notar, Grundbuch, Makler) → **closing costs** (state/local transfer tax, title insurance, escrow/settlement, recording, lender fees/points, appraisal, inspection, prepaid taxes/insurance/interest; buyer's agent per NAR 2024 settlement often negotiable)
- Annuität / Rate → monthly payment (P&I); with taxes+insurance+HOA → **PITIA**
- Tilgungsplan → amortization schedule · Sondertilgung → extra principal payment · Sollzins → interest rate · effektiver Jahreszins → APR
- Zinsbindung / Anschlusszins / Forward → fixed-rate period, ARM reset, refinance/rate lock (US standard: 30-year fixed)
- Beleihungswert / Beleihungsauslauf → appraised value / **LTV** · Eigenkapital → down payment / cash to close · Kapitaldienstfähigkeit → **DTI** (personal) and **DSCR** (investment)
- Schufa → credit score (FICO) · Bank → lender · Bankgespräch → lender meeting · Finanzierungsvermittler → mortgage broker (NMLS-licensed)
- Mietrendite brutto/netto → gross yield / cap rate · Eigenkapitalrendite → cash-on-cash return · IRR stays IRR
- Hausgeld → HOA dues · Grundsteuer → property tax · Instandhaltungsrücklage → repairs & capex reserve · Mietausfallwagnis → vacancy allowance · Hausverwaltung → property management
- AfA (2 %/2.5 %/3 %) → **depreciation: 27.5 years residential / 39 years commercial, straight-line, land not depreciable**, bonus/cost segregation mentioned as CPA topic · Anlage V → **Schedule E** · Werbungskosten → deductible rental expenses · Erhaltungsaufwand vs. Herstellungskosten → repairs vs. capital improvements
- Spekulationsfrist / Verkauf → capital gains (short/long term), depreciation recapture (25 %), NIIT 3.8 %, **1031 exchange** (45/180 days)
- Mieterhöhung / Mietspiegel / Kappungsgrenze → rent increase rules: notice periods and state/local rent control (CA AB1482, OR, NYC rent stabilization …) — show as "check your state/city", no legal advice
- Mahnverfahren → late rent, notice to pay or quit, eviction (state-specific) · Kaution → security deposit (state limits)
- Steuerberater → **CPA** · Notar → title/escrow company or closing attorney · Makler → real estate agent · Gutachter → appraiser · Hausverwaltung → property manager
- Käufer-Pass / Investor Pro / Kostenlos → **Buyer Pass / Investor Pro / Free**; Business: **Basic / Pro / Enterprise**
- Prices (USD): Lender Package **$39** one-time per property · Buyer Pass **$49** for 90 days · Investor Pro **$29/month** · Business Basic **$79/month**, Pro **$149/month**, Enterprise custom. Any other ImmoAdv price: convert to a sensible USD price point and list it in your report.
- DSGVO / TDDDG → US privacy (CCPA/CPRA and other state privacy laws; "Do Not Sell or Share" link; GPC signal honored) · AVV → DPA · Cookie banner stays (consent before analytics) · Widerrufsrecht → **refund policy** (no statutory 14-day right in the US; keep the existing generous refund/cancel flows as LeaseRun policy) · Kündigungsbutton → online cancellation (FTC negative-option rule / state auto-renewal laws: cancel as easily as sign-up) · Impressum → not required
- USt/MwSt, Rechnung nach §14 UStG, GoBD, DATEV, SEPA, IBAN → US invoices/receipts (no VAT; sales tax only if Stripe Tax is enabled), CSV export for the CPA, ACH/card via Stripe. Creator payouts: Stripe Connect / ACH, W-9 / 1099-NEC instead of IBAN/German tax ID.
- Bundesländer → US states (+ DC); PLZ → ZIP code; Straße/Hausnummer → street address; Grundbuch → county records
- Fonts, colors, gradients, spacing: **unchanged** (ImmoAdv style). Logos: LeaseRun.

## Final report of each area (keep it short)
- Done (bullet list)
- Needed in other areas (file + what)
- Legal flags (US)
- Open items
