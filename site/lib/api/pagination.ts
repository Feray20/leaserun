// Cursor-Paginierung über (created_at, id) – stabil auch bei gleichen Zeitstempeln.
import { ApiError } from '@/lib/api/errors';

export type Cursor = { t: string; id: string };

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify([c.t, c.id]), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  try {
    const [t, id] = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as [string, string];
    if (typeof t !== 'string' || typeof id !== 'string' || Number.isNaN(Date.parse(t)) || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('bad');
    return { t, id };
  } catch {
    throw new ApiError('INVALID_CURSOR', 'The cursor is malformed or expired.');
  }
}

export function pageParams(url: URL, max = 100): { limit: number; cursor: Cursor | null } {
  const l = url.searchParams.get('limit');
  const limit = l === null ? 25 : Number(l);
  if (!Number.isInteger(limit) || limit < 1 || limit > max) throw new ApiError('BAD_REQUEST', `limit must be an integer between 1 and ${max}.`, { errors: [{ field: 'limit', code: 'out_of_range', message: `1–${max}` }] });
  return { limit, cursor: decodeCursor(url.searchParams.get('cursor')) };
}

// PostgREST-Filter „älter als Cursor“ für absteigende Sortierung nach created_at, id.
export function cursorFilter(c: Cursor, timeCol = 'created_at'): string {
  const t = c.t.replace(/"/g, ''); // unverändert aus der Datenbank (Mikrosekunden bleiben erhalten)
  return `${timeCol}.lt."${t}",and(${timeCol}.eq."${t}",id.lt.${c.id})`;
}

export function pageOf<T extends { id: string }>(rows: T[], limit: number, timeOf: (r: T) => string) {
  const has_more = rows.length > limit;
  const data = rows.slice(0, limit);
  const last = data[data.length - 1];
  return { data, pagination: { has_more, next_cursor: has_more && last ? encodeCursor({ t: timeOf(last), id: last.id }) : null } };
}
