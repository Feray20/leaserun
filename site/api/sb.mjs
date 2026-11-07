// Where LeaseRun's database lives. Default: the Supabase project (until the move). After the move to the own server set
// the Worker variable LR_SB_URL (e.g. https://db.leaserun.com) and LR_SB_KEY (publishable/anon key of the new stack).
// The browser files (app.js, lr-app.js) carry the same two values – see docs/EIGENER_SERVER.md.
export const DEFAULT_SB_URL = 'https://pxexxguhgqfxwhtnwcrj.supabase.co';
export const DEFAULT_SB_KEY = 'sb_publishable_7Ga_tZ-JbJyVbA5e8YaGUg_DvftkCHP';
const clean = (u) => (/^https:\/\/[a-z0-9.-]+$/i.test(u || '') ? u : '');
export const sbUrl = () => clean((typeof process !== 'undefined' && process.env.LR_SB_URL) || '') || DEFAULT_SB_URL;
export const sbKey = () => (typeof process !== 'undefined' && process.env.LR_SB_KEY) || DEFAULT_SB_KEY;
