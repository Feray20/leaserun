'use client';
import { useMemo, useState } from 'react';
import { underwrite, type StressCase } from '@/lib/underwriting/engine';
import { bankReadyScore } from '@/lib/underwriting/score';

const DISCLAIMER =
  'Reines technisches Analyse-, Informations- und Vorbereitungsinstrument. Keine Kreditvermittlung oder Darlehensberatung (§ 34i GewO, KWG), keine Steuerberatung (StBerG), keine Rechtsdienstleistung (RDG).';

const nf = (d: number) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const ok = (n: number | null): n is number => n !== null && Number.isFinite(n);
const euro = (n: number | null) => (ok(n) ? `${nf(2).format(n)} €` : '–');
const pct = (n: number | null) => (ok(n) ? `${nf(1).format(n * 100)} %` : '–');
const dec = (n: number | null) => (ok(n) ? nf(2).format(n) : '–');
const clamp = (x: number) => Math.min(100, Math.max(0, x));

type P = {
  purchasePrice: number; monthlyNetRent: number; vacancyPct: number; monthlyNonRecoverableCosts: number;
  monthlyMaintenance: number; annualOperatingCashCosts: number; debtAmount: number; interestPct: number;
  repaymentPct: number; lendingValue: number; liquidityReserve: number; yearBuilt: number; buildingSharePct: number;
  marginalTaxPct: number; documentationScore: number; legalRiskScore: number; technicalRiskScore: number;
};

// Fiktiver Beispielfall – alle Werte sind editierbar.
const DEFAULTS: P = {
  purchasePrice: 400000, monthlyNetRent: 2200, vacancyPct: 2, monthlyNonRecoverableCosts: 250, monthlyMaintenance: 200,
  annualOperatingCashCosts: 600, debtAmount: 300000, interestPct: 4, repaymentPct: 3, lendingValue: 350000,
  liquidityReserve: 30000, yearBuilt: 1995, buildingSharePct: 0, marginalTaxPct: 0,
  documentationScore: 0, legalRiskScore: 0, technicalRiskScore: 0,
};

const FIELDS: [keyof P, string, string][] = [
  ['purchasePrice', 'Kaufpreis', '€'], ['monthlyNetRent', 'Nettokaltmiete / Monat', '€'], ['vacancyPct', 'Leerstand / Mietausfall', '%'],
  ['monthlyNonRecoverableCosts', 'Nicht umlagefähig / Monat', '€'], ['monthlyMaintenance', 'Instandhaltung / Monat', '€'],
  ['annualOperatingCashCosts', 'Sonstige Kosten / Jahr', '€'], ['debtAmount', 'Darlehen', '€'], ['interestPct', 'Sollzins', '%'],
  ['repaymentPct', 'Anfängliche Tilgung', '%'], ['lendingValue', 'Beleihungswert', '€'], ['liquidityReserve', 'Liquiditätsreserve', '€'],
];
const TAX_FIELDS: [keyof P, string, string][] = [
  ['yearBuilt', 'Baujahr', ''], ['buildingSharePct', 'Gebäudeanteil am Kaufpreis', '%'], ['marginalTaxPct', 'Grenzsteuersatz', '%'],
];
const CHECKS: [keyof P, string][] = [
  ['documentationScore', 'Unterlagen geprüft (0–100)'], ['legalRiskScore', 'Rechtliche Prüfung (0–100)'], ['technicalRiskScore', 'Technische Prüfung (0–100)'],
];

type Tone = 'ok' | 'warn' | 'bad' | 'none';
const tone = (v: number | null, good: number, warn: number, higherIsBetter = true): Tone => {
  if (!ok(v)) return 'none';
  if (higherIsBetter) return v >= good ? 'ok' : v >= warn ? 'warn' : 'bad';
  return v <= good ? 'ok' : v <= warn ? 'warn' : 'bad';
};
type View = 'einsteiger' | 'bank' | 'detail';

function Radar({ axes }: { axes: { label: string; value: number | null }[] }) {
  const size = 220, c = size / 2, r = 80;
  const pts = axes.map((a, i) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / axes.length;
    const v = ok(a.value) ? a.value / 100 : 0;
    return { x: c + Math.cos(ang) * r * v, y: c + Math.sin(ang) * r * v, lx: c + Math.cos(ang) * (r + 22), ly: c + Math.sin(ang) * (r + 22), a };
  });
  const ring = (f: number) => axes.map((_, i) => { const ang = -Math.PI / 2 + (i * 2 * Math.PI) / axes.length; return `${c + Math.cos(ang) * r * f},${c + Math.sin(ang) * r * f}`; }).join(' ');
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="ck-radar" role="img" aria-label="Entscheidungsradar">
      {[0.25, 0.5, 0.75, 1].map((f) => <polygon key={f} points={ring(f)} fill="none" stroke="#CBD5E1" strokeWidth="0.75" />)}
      <polygon points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(30,41,59,0.15)" stroke="#1E293B" strokeWidth="1.5" />
      {pts.map((p) => (
        <text key={p.a.label} x={p.lx} y={p.ly} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill="#334155">
          {p.a.label} {ok(p.a.value) ? Math.round(p.a.value) : '–'}
        </text>
      ))}
    </svg>
  );
}

export default function Cockpit() {
  const [p, setP] = useState<P>(DEFAULTS);
  const [view, setView] = useState<View>('einsteiger');
  const set = (k: keyof P, v: string) => setP((x) => ({ ...x, [k]: v === '' ? 0 : Number(v) }));

  const a = useMemo(() => {
    const i = p.interestPct / 100, rep = p.repaymentPct / 100, v = p.vacancyPct / 100;
    const cases: StressCase[] = [
      { name: 'base', interestRate: i, vacancyRate: v, maintenanceMultiplier: 1 },
      { name: 'base', interestRate: i + 0.01, vacancyRate: Math.min(1, v + 0.03), maintenanceMultiplier: 1.1 },
      { name: 'worst', interestRate: i + 0.025, vacancyRate: Math.min(1, v + 0.08), maintenanceMultiplier: 1.25 },
      { name: 'worst', interestRate: i + 0.04, vacancyRate: Math.min(1, v + 0.15), maintenanceMultiplier: 1.5 },
    ];
    const valid = p.purchasePrice > 0 && p.lendingValue > 0 && p.monthlyNetRent >= 0 && p.monthlyNonRecoverableCosts >= 0 && p.debtAmount >= 0;
    const uw = valid
      ? underwrite({
          annualNetColdRent: p.monthlyNetRent * 12, vacancyRate: v, nonRecoverableOperatingCosts: p.monthlyNonRecoverableCosts * 12,
          annualMaintenance: p.monthlyMaintenance * 12, annualOtherCashCosts: p.annualOperatingCashCosts,
          annualInterest: p.debtAmount * i, annualPrincipal: p.debtAmount * rep, loanAmount: p.debtAmount,
          lendingValue: p.lendingValue, purchasePrice: p.purchasePrice,
        }, cases)
      : null;
    if (!uw) return null;
    const ds = uw.debtService;
    const checksDone = p.documentationScore > 0 && p.legalRiskScore > 0 && p.technicalRiskScore > 0;
    const sc = bankReadyScore({
      dscr: uw.dscr, icr: uw.icr, ltv: uw.ltvPurchasePrice, documentCompleteness: p.documentationScore,
      legalRisk: 100 - p.legalRiskScore, technicalRisk: 100 - p.technicalRiskScore,
      cashReserveMonths: ds > 0 ? p.liquidityReserve / (ds / 12) : 12,
    });
    const veto = ds > 0 && uw.dscr < 1;
    const score = veto ? Math.min(sc.score, 49) : sc.score;

    // Steuer (vereinfachtes erstes Jahr)
    const afaRate = p.yearBuilt >= 2023 ? 0.03 : p.yearBuilt > 0 && p.yearBuilt < 1925 ? 0.025 : 0.02;
    const afa = p.buildingSharePct > 0 ? p.purchasePrice * (p.buildingSharePct / 100) * afaRate : null;
    const taxable = ok(afa) ? uw.noi - p.debtAmount * i - afa : null;
    const taxEffect = ok(taxable) ? -taxable * (p.marginalTaxPct / 100) : null;
    const cfBefore = uw.cfads - ds;
    const rent = p.monthlyNetRent * 12;

    const extreme = uw.stress[3]?.dscr ?? null;
    const axes = [
      { label: 'Cashflow', value: ds > 0 ? clamp((uw.dscr / 1.25) * 100) : 100 },
      { label: 'Substanz', value: clamp(((1 - uw.ltvLendingValue) / 0.4) * 100) },
      { label: 'Steuer', value: ok(afa) && rent > 0 ? clamp(((afa / rent) / 0.25) * 100) : null },
      { label: 'Downside', value: ok(extreme) && ds > 0 ? clamp(extreme * 100) : 100 },
    ];
    return { uw, ds, sc, score, veto, checksDone, afa, afaRate, taxEffect, cfBefore, axes };
  }, [p]);

  const scoreTone: Tone = !a ? 'none' : a.veto ? 'bad' : !a.checksDone ? 'none' : a.score >= 70 ? 'ok' : a.score >= 50 ? 'warn' : 'bad';
  const showScore = a && (a.checksDone || a.veto);

  return (
    <div className="ck">
      <header className="ck-top">
        <a className="ck-brand" href="/"><img src="/logo-icon.svg" alt="" width={34} height={29} />Immo<em>Adv</em></a>
        <nav><a href="/learn">Wissen</a><a href="/checklist">Checkliste</a><a href="/profiler">Profiler</a><a href="/sample-loan-package">Mustermappe</a></nav>
      </header>

      <main className="ck-wrap">
        <div className="ck-head">
          <div>
            <div className="ck-kicker">Investment-Cockpit</div>
            <h1>Objekt- und Kapitaldienstprüfung</h1>
            <p className="ck-muted">Fiktiver Beispielfall. Alle Werte sind editierbar und werden nur in diesem Browser berechnet.</p>
          </div>
          <div className="ck-tabs" role="tablist" aria-label="Ansicht">
            {([['einsteiger', 'Einsteiger'], ['bank', 'Bankansicht'], ['detail', 'Detailprüfung']] as const).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>
            ))}
          </div>
        </div>

        <section className="ck-grid">
          <aside className="ck-card">
            <h2>Objekt &amp; Finanzierung</h2>
            {FIELDS.map(([k, l, u]) => (
              <label key={k} className="ck-field"><span>{l}</span>
                <span className="ck-input"><input type="number" inputMode="decimal" value={p[k]} onChange={(e) => set(k, e.target.value)} /><em>{u}</em></span>
              </label>
            ))}
            <h3>Steuer (optional)</h3>
            {TAX_FIELDS.map(([k, l, u]) => (
              <label key={k} className="ck-field"><span>{l}</span>
                <span className="ck-input"><input type="number" inputMode="decimal" value={p[k]} onChange={(e) => set(k, e.target.value)} />{u && <em>{u}</em>}</span>
              </label>
            ))}
            <h3>Prüfstand (Selbsteinschätzung)</h3>
            {CHECKS.map(([k, l]) => (
              <label key={k} className="ck-field"><span>{l}</span>
                <span className="ck-input"><input type="number" min={0} max={100} value={p[k]} onChange={(e) => set(k, e.target.value)} /><em>Pkt.</em></span>
              </label>
            ))}
            <p className="ck-note">0 = ungeprüft. Ohne Prüfung bleibt der Score im Status „Ungeprüft“.</p>
          </aside>

          {!a ? (
            <section className="ck-main"><div className="ck-card"><p>Bitte Kaufpreis und Beleihungswert größer 0 eingeben.</p></div></section>
          ) : (
            <section className="ck-main">
              {view === 'einsteiger' && (
                <div className="ck-card">
                  <h2>Das Wichtigste in einfachen Worten</h2>
                  <div className="ck-explain">
                    <div><strong>Trägt sich die Wohnung?</strong><p>{a.ds === 0 ? 'Ohne Darlehen gibt es keinen Kapitaldienst.' : a.uw.dscr >= 1 ? `Ja. Die Miete deckt Zins und Tilgung ${dec(a.uw.dscr)}-fach.` : `Nein. Die Miete deckt nur ${pct(a.uw.dscr)} von Zins und Tilgung; den Rest zahlen Sie aus Ihrem Einkommen.`}</p></div>
                    <div><strong>Was bleibt monatlich?</strong><p>{euro(a.cfBefore / 12)} vor Steuern{ok(a.taxEffect) ? `, rund ${euro((a.cfBefore + a.taxEffect) / 12)} nach Steuern` : ''}.</p></div>
                    <div><strong>Wie viel leiht die Bank im Verhältnis zum Wert?</strong><p>{pct(a.uw.ltvLendingValue)} des Beleihungswerts.{a.uw.ltvLendingValue > 1 ? ' Darüber liegt ein Blankoanteil, das wird meist teurer.' : ''}</p></div>
                    <div><strong>Was, wenn Zinsen und Leerstand steigen?</strong><p>Im extremen Szenario sinkt die Deckung auf {dec(a.uw.stress[3]?.dscr ?? null)}.</p></div>
                  </div>
                  <Radar axes={a.axes} />
                  <p className="ck-note">Achsen (0–100, LeaseRun-Definition): Cashflow = DSCR ÷ 1,25; Substanz = Abstand des Beleihungsauslaufs zu 100 %; Steuer = AfA im Verhältnis zur Jahresmiete (25 % = 100); Downside = DSCR im extremen Stressfall.</p>
                </div>
              )}

              {view !== 'einsteiger' && (
                <div className="ck-card">
                  <h2>Kennzahlen</h2>
                  <table className="ck-table">
                    <thead><tr><th>Kennzahl</th><th>Wert</th><th>Status</th></tr></thead>
                    <tbody>
                      <tr><td>NOI (Nettomietertrag p. a.)</td><td>{euro(a.uw.noi)}</td><td><i className="st none">Information</i></td></tr>
                      <tr><td>CFADS (verfügbar für Kapitaldienst p. a.)</td><td>{euro(a.uw.cfads)}</td><td><i className="st none">Information</i></td></tr>
                      <tr><td>Kapitaldienst p. a.</td><td>{euro(a.ds)}</td><td><i className="st none">Information</i></td></tr>
                      <tr><td>DSCR (CFADS ÷ Kapitaldienst)</td><td>{a.ds ? dec(a.uw.dscr) : '–'}</td><td><i className={`st ${tone(a.ds ? a.uw.dscr : null, 1.2, 1)}`}>{!a.ds ? 'Kein Darlehen' : a.uw.dscr >= 1.2 ? 'Tragfähig' : a.uw.dscr >= 1 ? 'Knapp' : 'Nicht gedeckt'}</i></td></tr>
                      <tr><td>ICR (NOI ÷ Zinsaufwand)</td><td>{a.uw.icr ? dec(a.uw.icr) : '–'}</td><td><i className={`st ${tone(a.uw.icr || null, 2, 1.5)}`}>{!a.uw.icr ? 'Kein Zins' : a.uw.icr >= 2 ? 'Tragfähig' : a.uw.icr >= 1.5 ? 'Knapp' : 'Schwach'}</i></td></tr>
                      <tr><td>LTV (Darlehen ÷ Kaufpreis)</td><td>{pct(a.uw.ltvPurchasePrice)}</td><td><i className={`st ${tone(a.uw.ltvPurchasePrice, 0.8, 0.9, false)}`}>{a.uw.ltvPurchasePrice <= 0.8 ? 'Im Rahmen' : a.uw.ltvPurchasePrice <= 0.9 ? 'Erhöht' : 'Hoch'}</i></td></tr>
                      <tr><td>Beleihungsauslauf (Darlehen ÷ Beleihungswert)</td><td>{pct(a.uw.ltvLendingValue)}</td><td><i className={`st ${tone(a.uw.ltvLendingValue, 0.8, 1, false)}`}>{a.uw.ltvLendingValue <= 0.8 ? 'Im Rahmen' : a.uw.ltvLendingValue <= 1 ? 'Erhöht' : 'Blankoanteil'}</i></td></tr>
                      <tr><td>Cashflow vor Steuern pro Monat</td><td>{euro(a.cfBefore / 12)}</td><td><i className={`st ${a.cfBefore >= 0 ? 'ok' : 'warn'}`}>{a.cfBefore >= 0 ? 'Positiv' : 'Zuzahlung'}</i></td></tr>
                      {ok(a.afa) && <tr><td>Lineare AfA ({nf(1).format(a.afaRate * 100)} %, § 7 Abs. 4 EStG)</td><td>{euro(a.afa)}</td><td><i className="st none">Modell</i></td></tr>}
                      {ok(a.taxEffect) && <tr><td>Steuerwirkung p. a. (vereinfacht)</td><td>{euro(a.taxEffect)}</td><td><i className="st none">Modell</i></td></tr>}
                    </tbody>
                  </table>
                  <p className="ck-note">Schwellenwerte sind LeaseRun-interne Risikopolitik, keine gesetzlichen Vorgaben oder Kriterien einer bestimmten Bank.</p>
                </div>
              )}

              {view !== 'einsteiger' && (
                <div className="ck-card">
                  <h2>Stresstest</h2>
                  <table className="ck-table">
                    <thead><tr><th>Szenario</th><th>Annahmen</th><th>Cashflow p. a.</th><th>DSCR</th></tr></thead>
                    <tbody>
                      {a.uw.stress.map((s, k) => (
                        <tr key={k}>
                          <td>{['Basisfall', 'Moderat', 'Schwer', 'Extrem'][k]}</td>
                          <td>{['Eingaben', 'Zins +1,0 Pkt., Leerstand +3 Pkt., Instandh. +10 %', 'Zins +2,5 Pkt., Leerstand +8 Pkt., Instandh. +25 %', 'Zins +4,0 Pkt., Leerstand +15 Pkt., Instandh. +50 %'][k]}</td>
                          <td>{euro(s.annualCashflow)}</td>
                          <td><i className={`st ${tone(a.ds ? s.dscr : null, 1.2, 1)}`}>{a.ds ? dec(s.dscr) : '–'}</i></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {view === 'detail' && (
                <div className="ck-card">
                  <h2>Score-Treiber</h2>
                  <table className="ck-table">
                    <thead><tr><th>Komponente</th><th>Teilwert</th><th>Punkte</th></tr></thead>
                    <tbody>
                      {a.sc.components.map((c) => (
                        <tr key={c.key}><td>{c.label} ({nf(0).format(c.weight * 100)} %)</td><td>{c.value} / 100</td><td>{nf(1).format(c.points)} von {nf(0).format(c.max)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="ck-note">DSCR-Teilwert = DSCR ÷ 1,50; ICR = ICR ÷ 3,00; LTV = 100 bei ≤ 60 %, 0 bei ≥ 100 %; Liquiditätsreserve = Monate Kapitaldienst ÷ 12. Bei DSCR unter 1,00 wird der Gesamtscore auf 49 gedeckelt.</p>
                  <Radar axes={a.axes} />
                </div>
              )}
            </section>
          )}

          <aside className="ck-side">
            <div className="ck-card">
              <div className="ck-kicker">Banken-Ready-Score</div>
              <div className="ck-score">{showScore ? a!.score : '–'}<small>/100</small></div>
              <div className="ck-bar"><div className={`ck-fill ${scoreTone}`} style={{ width: `${showScore ? a!.score : 0}%` }} /></div>
              <p className="ck-note">{!a ? '' : a.veto ? 'Gedeckelt auf höchstens 49, weil der DSCR unter 1,00 liegt.' : !a.checksDone ? 'Ungeprüft: Bitte den Prüfstand ausfüllen.' : 'Interne LeaseRun-Einstufung. Keine Bankzusage.'}</p>
            </div>
            <div className="ck-card">
              <h2>Veto-Center</h2>
              {a?.veto ? <div className="ck-flag bad">Bedingtes Veto: DSCR unter 1,00 – die Mieteinnahmen decken den Kapitaldienst nicht.</div> : <div className="ck-flag ok">Keine Abweichung beim Kapitaldienst erkannt.</div>}
              <div className="ck-flag warn">Kennzahlen sind erst belastbar, wenn sie mit Unterlagen belegt sind.</div>
            </div>
            <div className="ck-card">
              <h2>Nächste Schritte</h2>
              <p className="ck-note">Objekt im Konto speichern, Unterlagen hochladen und daraus die Kreditmappe als PDF erstellen.</p>
              <p><a className="ck-link" href="/app/dashboard">Zum Konto</a> · <a className="ck-link" href="/api/mustermappe" target="_blank" rel="noopener">Muster-Kreditmappe (PDF)</a></p>
            </div>
          </aside>
        </section>

        <footer className="ck-foot">
          <p>{DISCLAIMER}</p>
          <p><a href="/legal-notice">Impressum</a> · <a href="/privacy">Datenschutz</a> · <a href="/terms">AGB</a> · <a href="/cancel">Verträge hier kündigen</a> · <a href="/refund">Vertrag widerrufen</a></p>
        </footer>
      </main>
    </div>
  );
}
