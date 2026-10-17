import crypto from 'node:crypto';

export function hashAuditValue(value: string | undefined): string | null {
  if (!value) return null;
  const salt = process.env.AUDIT_HASH_SALT;
  if (!salt) throw new Error('AUDIT_HASH_SALT_not_configured');
  return crypto.createHmac('sha256', salt).update(value, 'utf8').digest('hex');
}
