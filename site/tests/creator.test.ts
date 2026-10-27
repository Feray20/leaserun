import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { bicRequired, checkIban, groupIban, maskIban, normalizeIban, validBic } from '../lib/creator/iban';
import { fingerprint, keyringFrom, open, seal } from '../lib/creator/vault';
import { ADMIN_ROLES, can, effectiveRole, permissionsOf } from '../lib/creator/roles';
import { adminTransition, allowedAdminActions, completeness, creatorCanEdit, creatorCanSubmit, missingSteps, nextBestAction, refCodeFrom, sanitizeMeta, type OnboardingState } from '../lib/creator/model';

// ---------------- IBAN ----------------
test('IBAN: gültige Beispiele (DE, GB, AT, NL, CH, PT)', () => {
  for (const i of ['DE89 3704 0044 0532 0130 00', 'GB82 WEST 1234 5698 7654 32', 'AT61 1904 3002 3457 3201', 'NL91ABNA0417164300', 'CH9300762011623852957', 'PT50000201231234567890154']) {
    const r = checkIban(i);
    assert.equal(r.ok, true, i);
  }
});

test('IBAN: Leerzeichen, Bindestriche und Kleinschreibung werden normalisiert', () => {
  assert.equal(normalizeIban(' de89-3704 0044.0532 0130 00 '), 'DE89370400440532013000');
  const r = checkIban('de89 3704 0044 0532 0130 00');
  assert.ok(r.ok && r.iban === 'DE89370400440532013000' && r.country === 'DE' && r.last4 === '3000' && r.sepa);
});

test('IBAN: Fehlerarten (Prüfziffer, Länge, Land, Format)', () => {
  assert.deepEqual(checkIban('DE88 3704 0044 0532 0130 00'), { ok: false, reason: 'checksum' });
  assert.deepEqual(checkIban('DE89 3704 0044 0532 0130 0'), { ok: false, reason: 'length' });
  assert.deepEqual(checkIban('ZZ89 3704 0044 0532 0130 00'), { ok: false, reason: 'country' });
  assert.deepEqual(checkIban('hallo'), { ok: false, reason: 'format' });
  assert.deepEqual(checkIban(''), { ok: false, reason: 'format' });
});

test('IBAN: Maske verrät die Länge nicht und zeigt nur Land + letzte 4', () => {
  assert.equal(maskIban('DE', '4821'), 'DE••••••••••4821');
  assert.equal(maskIban('NL', '4300').length, maskIban('DE', '4821').length);
  assert.equal(groupIban('DE89370400440532013000'), 'DE89 3704 0044 0532 0130 00');
});

test('BIC: Pflicht nur außerhalb SEPA, Format', () => {
  assert.equal(bicRequired('DE'), false);
  assert.equal(bicRequired('AE'), true);
  assert.equal(validBic('COBADEFFXXX'), true);
  assert.equal(validBic('COBADEFF'), true);
  assert.equal(validBic('COBA'), false);
});

// ---------------- Tresor ----------------
const k1 = 'v1:' + randomBytes(32).toString('base64');
const k2 = 'v2:' + randomBytes(32).toString('base64');

test('Tresor: verschlüsseln/entschlüsseln, Chiffrat enthält keinen Klartext', () => {
  const ring = keyringFrom(k1);
  const s = seal('DE89370400440532013000', 'creator-a', ring);
  assert.match(s, /^v1:/);
  assert.ok(!s.includes('DE89') && !s.includes('3000'));
  assert.equal(open(s, 'creator-a', ring), 'DE89370400440532013000');
  assert.notEqual(seal('DE89370400440532013000', 'creator-a', ring), s, 'zufälliger IV je Vorgang');
});

test('Tresor: Chiffrat ist an den Creator gebunden (kein Vertauschen möglich)', () => {
  const ring = keyringFrom(k1);
  const s = seal('DE89370400440532013000', 'creator-a', ring);
  assert.throws(() => open(s, 'creator-b', ring));
});

test('Tresor: Manipulation wird erkannt', () => {
  const ring = keyringFrom(k1);
  const [v, iv, tag, ct] = seal('DE89370400440532013000', 'a', ring).split(':');
  const bad = Buffer.from(ct, 'base64'); bad[0] ^= 1;
  assert.throws(() => open([v, iv, tag, bad.toString('base64')].join(':'), 'a', ring));
});

test('Tresor: Schlüsselrotation – alte Daten bleiben lesbar, neue nutzen den neuen Schlüssel', () => {
  const old = seal('DE89370400440532013000', 'a', keyringFrom(k1));
  const ring = keyringFrom(k2, k1);
  assert.equal(open(old, 'a', ring), 'DE89370400440532013000');
  assert.match(seal('X', 'a', ring), /^v2:/);
  assert.throws(() => open(old, 'a', keyringFrom(k2)), /vault_key_unknown/);
});

test('Tresor: ungültige oder fehlende Schlüssel werden abgelehnt', () => {
  assert.throws(() => keyringFrom(undefined), /missing/);
  assert.throws(() => keyringFrom('v1:abc'), /invalid/);
  assert.throws(() => keyringFrom(randomBytes(32).toString('base64')), /invalid/);
});

test('Fingerabdruck: stabil, schlüsselabhängig, ohne Klartext', () => {
  const r = keyringFrom(k1);
  const f = fingerprint('DE89370400440532013000', r);
  assert.match(f, /^[0-9a-f]{64}$/);
  assert.equal(f, fingerprint('DE89370400440532013000', r));
  assert.notEqual(f, fingerprint('DE89370400440532013000', keyringFrom(k2)));
});

// ---------------- Rollen ----------------
test('Rollen: nur Super/Finance sehen vollständige Zahlungsdaten', () => {
  const reveal = ADMIN_ROLES.filter((r) => can(r, 'bank.reveal'));
  assert.deepEqual(reveal, ['SUPER_ADMIN', 'FINANCE_ADMIN']);
});

test('Rollen: Freigabe nur Super/Creator Manager; Rollenvergabe nur Super', () => {
  assert.deepEqual(ADMIN_ROLES.filter((r) => can(r, 'creators.review')), ['SUPER_ADMIN', 'CREATOR_MANAGER']);
  assert.deepEqual(ADMIN_ROLES.filter((r) => can(r, 'roles.manage')), ['SUPER_ADMIN']);
});

test('Rollen: Read Only und Support dürfen nichts verändern', () => {
  for (const r of ['READ_ONLY', 'SUPPORT'] as const) {
    for (const p of ['creators.review', 'creators.suspend', 'bank.reveal', 'bank.verify', 'roles.manage'] as const) assert.equal(can(r, p), false, `${r} ${p}`);
  }
  assert.equal(can('READ_ONLY', 'creators.business'), false);
  assert.equal(can('SUPPORT', 'creators.business'), false);
});

test('Rollen: fehlende Zuordnung = Super Admin, ungültiger Wert = Nur lesen', () => {
  assert.equal(effectiveRole(null), 'SUPER_ADMIN');
  assert.equal(effectiveRole(undefined), 'SUPER_ADMIN');
  assert.equal(effectiveRole('GOD'), 'READ_ONLY');
  assert.equal(effectiveRole('FINANCE_ADMIN'), 'FINANCE_ADMIN');
  assert.ok(permissionsOf('READ_ONLY').length < permissionsOf('SUPER_ADMIN').length);
});

// ---------------- Status ----------------
test('Status: erlaubte Admin-Übergänge', () => {
  assert.equal(adminTransition('SUBMITTED', 'APPROVE'), 'ACTIVE');
  assert.equal(adminTransition('UNDER_REVIEW', 'REQUEST_INFO'), 'INFO_REQUESTED');
  assert.equal(adminTransition('UNDER_REVIEW', 'REJECT'), 'REJECTED');
  assert.equal(adminTransition('ACTIVE', 'SUSPEND'), 'SUSPENDED');
  assert.equal(adminTransition('SUSPENDED', 'REACTIVATE'), 'ACTIVE');
});

test('Status: unzulässige Übergänge werden abgewiesen', () => {
  assert.equal(adminTransition('DRAFT', 'APPROVE'), null, 'unvollständige Bewerbung nicht freigeben');
  assert.equal(adminTransition('REJECTED', 'APPROVE'), null);
  assert.equal(adminTransition('ACTIVE', 'APPROVE'), null);
  assert.equal(adminTransition('SUSPENDED', 'APPROVE'), null);
  assert.deepEqual(allowedAdminActions('DRAFT'), []);
});

test('Status: Bearbeiten während der Prüfung gesperrt', () => {
  assert.equal(creatorCanEdit('UNDER_REVIEW', 'profile'), false);
  assert.equal(creatorCanEdit('SUBMITTED', 'payout'), false);
  assert.equal(creatorCanEdit('INFO_REQUESTED', 'business'), true);
  assert.equal(creatorCanEdit('ACTIVE', 'payout'), true);
  assert.equal(creatorCanEdit('ACTIVE', 'account'), false);
  assert.equal(creatorCanEdit('SUSPENDED', 'payout'), false);
  assert.equal(creatorCanSubmit('DRAFT'), true);
  assert.equal(creatorCanSubmit('ACTIVE'), false);
});

const full: OnboardingState = {
  status: 'DRAFT', emailConfirmed: true,
  account: { first_name: 'Nahim', last_name: 'Sky', country: 'DE' },
  profile: { display_name: 'Nahim Sky', categories: ['immobilien'] },
  socialCount: 1, business: { legal_name: 'Nahim Sky' }, payout: { status: 'PROVIDED' }, agreementAccepted: true,
};

test('Vollständigkeit und nächste Aufgabe', () => {
  assert.deepEqual(missingSteps(full), []);
  assert.equal(nextBestAction(full, null)?.key, 'submit');
  const noPay = { ...full, payout: null };
  assert.deepEqual(missingSteps(noPay), ['payout']);
  assert.equal(nextBestAction(noPay, null)?.key, 'step:payout');
  assert.equal(completeness({ ...full, emailConfirmed: false }).account, false);
  assert.equal(nextBestAction({ ...full, emailConfirmed: false }, null)?.key, 'email');
  assert.equal(nextBestAction({ ...full, status: 'INFO_REQUESTED' }, 'Bitte Website')?.key, 'info');
  assert.equal(nextBestAction({ ...full, status: 'ACTIVE', payout: { status: 'VERIFICATION_REQUIRED' } }, null)?.key, 'payout-review');
  assert.equal(nextBestAction({ ...full, status: 'ACTIVE', agreementAccepted: false }, null)?.key, 'agreement');
  assert.equal(nextBestAction({ ...full, status: 'ACTIVE' }, null), null);
});

test('Attributions-Code: 10 Zeichen, nur unverwechselbare Zeichen, keine personenbezogenen Daten', () => {
  const c = refCodeFrom(randomBytes(10));
  assert.match(c, /^[a-km-np-z2-9]{10}$/);
  assert.throws(() => refCodeFrom(new Uint8Array(4)));
});

test('Protokoll-Metadaten: keine IBAN, keine Nachricht, keine Kontaktdaten', () => {
  const m = sanitizeMeta({ iban: 'DE89', iban_last4: '3000', holder_name: 'X', from: 'DRAFT', to: 'ACTIVE', message: 'geheim', email: 'a@b.de', ok: true, n: 3, obj: { a: 1 } });
  assert.deepEqual(m, { from: 'DRAFT', to: 'ACTIVE', ok: true, n: 3 });
});

// ---------------- Phase 2 ----------------
import { portalNextAction } from '../lib/creator/model';

test('Rollen Phase 2: Kampagnen nur Super/Creator Manager, Conversions zurücknehmen nur Super/Finance', () => {
  assert.deepEqual(ADMIN_ROLES.filter((r) => can(r, 'campaigns.manage')), ['SUPER_ADMIN', 'CREATOR_MANAGER']);
  assert.deepEqual(ADMIN_ROLES.filter((r) => can(r, 'content.review')), ['SUPER_ADMIN', 'CREATOR_MANAGER']);
  assert.deepEqual(ADMIN_ROLES.filter((r) => can(r, 'conversions.manage')), ['SUPER_ADMIN', 'FINANCE_ADMIN']);
  assert.equal(can('SUPPORT', 'conversions.read'), false);
});

test('Portal: nächste Aufgabe (Anmerkung > neue Kampagne > Content veröffentlichen)', () => {
  const now = new Date('2026-10-23T12:00:00Z');
  const k = (slug: string, days: number, has = false) => ({ slug, name: slug, created_at: new Date(now.getTime() - days * 86_400_000).toISOString(), hasMyContent: has });
  assert.equal(portalNextAction({ contentChangesRequested: 1, campaigns: [k('a', 1)], now })?.key, 'content-fix');
  assert.equal(portalNextAction({ contentChangesRequested: 0, campaigns: [k('alt', 30), k('neu', 2)], now })?.key, 'campaign:neu');
  assert.equal(portalNextAction({ contentChangesRequested: 0, campaigns: [k('alt', 30)], now })?.key, 'publish:alt');
  assert.equal(portalNextAction({ contentChangesRequested: 0, campaigns: [k('alt', 30, true)], now }), null);
});

test('Rollen Phase 3: Monatsabschluss und Auszahlungen nur Super/Finance; Abrechnung lesen ohne Support', () => {
  assert.deepEqual(ADMIN_ROLES.filter((r) => can(r, 'billing.manage')), ['SUPER_ADMIN', 'FINANCE_ADMIN']);
  assert.deepEqual(ADMIN_ROLES.filter((r) => can(r, 'payouts.manage')), ['SUPER_ADMIN', 'FINANCE_ADMIN']);
  assert.deepEqual(ADMIN_ROLES.filter((r) => can(r, 'billing.read')), ['SUPER_ADMIN', 'FINANCE_ADMIN', 'CREATOR_MANAGER', 'READ_ONLY']);
});
