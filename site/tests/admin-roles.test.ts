import test from 'node:test';
import assert from 'node:assert/strict';
import { AREA_ROLES, areasOf, canAccess, isTeamRole, TEAM_ROLES, type AdminArea } from '../lib/security/roles';

test('Inhaber darf alles, auch ohne angegebenen Bereich', () => {
  assert.equal(canAccess('owner'), true);
  for (const a of Object.keys(AREA_ROLES) as AdminArea[]) assert.equal(canAccess('owner', a), true);
});

test('Ohne Bereich ist die Schnittstelle nur für den Inhaber (Standard ist verschlossen)', () => {
  for (const r of TEAM_ROLES) assert.equal(canAccess(r), false);
  assert.equal(canAccess(null, 'stats'), false);
  assert.equal(canAccess(undefined, 'stats'), false);
});

test('Support: Postfach, Termine, Anfragen, Statistik – keine Finanzen', () => {
  assert.deepEqual(areasOf('support').sort(), ['mail', 'stats', 'support', 'termine']);
  assert.equal(canAccess('support', 'finance'), false);
});

test('Buchhaltung: Finanzen und Statistik – kein Postfach, keine Termine', () => {
  assert.deepEqual(areasOf('finance').sort(), ['finance', 'stats']);
  assert.equal(canAccess('finance', 'mail'), false);
  assert.equal(canAccess('finance', 'termine'), false);
});

test('Nur lesen: ausschließlich Statistik', () => {
  assert.deepEqual(areasOf('viewer'), ['stats']);
});

test('Team-Rollen: Inhaber kann nicht vergeben werden, Unbekanntes wird abgelehnt', () => {
  assert.equal(isTeamRole('owner'), false);
  assert.equal(isTeamRole('admin'), false);
  assert.equal(isTeamRole('support'), true);
});
