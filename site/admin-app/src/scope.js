import React, { useState } from 'react';
import { getScope, setScope } from './api';
import { Seg } from './ui';
// B2C ⇄ B2B wie im Web-Admin – strikt getrennte Daten.
export function useScope() {
  const [sc, set] = useState(getScope());
  const change = async (v) => { await setScope(v); set(v); };
  return [sc, change, <Seg key="sc" items={[['b2c', 'B2C · Privat'], ['b2b', 'B2B · Unternehmen']]} value={sc} onChange={change} />];
}
