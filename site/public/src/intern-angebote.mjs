// Deactivated: this module belonged to the retail/marketplace segment, which does not exist in LeaseRun.
// The file and its export are kept (nothing is deleted) so stale links fail gracefully instead of breaking.
import { esc } from './sess.mjs?v=892f3666';

export async function stAngebote(v) {
  v.innerHTML = `<section class="pt-card"><h2>${esc('Not available')}</h2><p class="form-note">This area isn't part of LeaseRun. Use the navigation to choose another section.</p></section>`;
}
