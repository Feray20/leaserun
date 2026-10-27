// Einheitliche Fußzeile für Privatbereich (B2C) und Unternehmensportal (B2B): Hinweis + rechtliche Links.
export function legalFoot(area = 'b2c') {
  const biz = area === 'b2b';
  return `<footer class="lr-legal" role="contentinfo"><div class="lr-legal-in">
    <nav class="lr-legal-links" aria-label="Rechtliches"><a href="/legal-notice">Impressum</a><a href="/privacy">Datenschutz</a><a href="/nutzungsbedingungen${biz ? '#b2b' : ''}">${biz ? 'AGB für Unternehmen' : 'Nutzungsbedingungen'}</a>${biz ? '' : '<a href="/cancel">Verträge kündigen</a><a href="/refund">Vertrag widerrufen</a>'}<a href="mailto:support@leaserun.com">Kontakt</a></nav>
    ${biz ? `<small>Technisches Analyse-, Informations- und Vorbereitungsinstrument. Rechnerische Orientierungswerte; keine Kreditvermittlung, keine Votierungs-, Bonitäts- oder Kreditentscheidung, keine Anlage-, Rechts-, Steuer- oder Finanzierungsberatung. Die Prüfpflicht nach MaRisk, KWG und § 34i GewO verbleibt beim beratenden bzw. finanzierenden Institut. <a href="/terms#hinweise">Rechtliche Hinweise</a> <span class="lr-copy">© 2026 LeaseRun</span></small>` : '<small>Technisches Analyse-, Informations- und Vorbereitungsinstrument. Keine Kreditvermittlung, keine Anlage-, Rechts-, Steuer- oder Finanzierungsberatung. <span class="lr-copy">© 2026 LeaseRun</span></small>'}
  </div></footer>`;
}
