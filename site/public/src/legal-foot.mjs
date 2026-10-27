// Shared footer for the personal area (B2C) and the business portal (B2B): notice + legal links.
export function legalFoot(area = 'b2c') {
  const biz = area === 'b2b';
  return `<footer class="lr-legal" role="contentinfo"><div class="lr-legal-in">
    <nav class="lr-legal-links" aria-label="Legal"><a href="/about">Company</a><a href="/privacy">Privacy</a><a href="/privacy#do-not-sell">Do Not Sell or Share My Personal Information</a><a href="/terms${biz ? '#b2b' : ''}">${biz ? 'Business Terms' : 'Terms of Service'}</a>${biz ? '' : '<a href="/cancel">Cancel subscription</a><a href="/refund">Refund policy</a>'}<a href="mailto:support@leaserun.com">Contact</a></nav>
    ${biz ? `<small>Software for analysis, information and preparation. Figures are estimates; LeaseRun is not a lender, mortgage broker or loan originator, makes no credit or underwriting decisions and gives no investment, legal, tax or financing advice. Licensing, disclosure and fair-lending obligations remain with the advising or lending institution. <a href="/terms#disclaimers">Legal notices</a> <span class="lr-copy">© 2026 LeaseRun</span></small>` : '<small>Software for analysis, information and preparation. Not a lender or mortgage broker; no investment, legal, tax or financing advice. <span class="lr-copy">© 2026 LeaseRun</span></small>'}
  </div></footer>`;
}
