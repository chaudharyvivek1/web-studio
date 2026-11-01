/**
 * WebStudio secret-at-rest encryption
 *
 * Authentication profiles hold live cookies and tokens for third-party sites.
 * Storing them as plaintext JSON means anyone who reads `data/webstudio.db` — a
 * backup, a snapshot, a shared volume — owns those sessions.
 *
 * Values are sealed with AES-256-GCM and marked with an `enc:v1:` prefix so that
 * pre-existing plaintext rows keep working and can be migrated lazily.
 *
 * Key derivation:
 *   WEBSTUDIO_SECRET  preferred
 *   WEBSTUDIO_ACCESS_TOKEN  fallback, so a protected deployment gets encryption
 *                            for free without a second variable
 *
 * With neither set, values are stored unencrypted and `isEncryptionEnabled()`
 * reports false so the UI and docs can say so plainly rather than implying a
 * protection that is not there.
 */

import crypto from 'crypto';

const PREFIX = 'enc:v1:';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

function rawSecret(): string | null {
  const secret = process.env.WEBSTUDIO_SECRET || process.env.WEBSTUDIO_ACCESS_TOKEN;
  if (!secret || secret.trim().length < 8) return null;
  return secret.trim();
}

/** Derive a stable 32-byte key from the configured secret. */
function deriveKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(`webstudio:auth-profile:${secret}`).digest();
}

export function isEncryptionEnabled(): boolean {
  return rawSecret() !== null;
}

/**
 * Encrypt a string. Returns the input unchanged when no secret is configured.
 */
export function encryptSecret(plaintext: string): string {
  const secret = rawSecret();
  if (!secret) return plaintext;
  if (plaintext.startsWith(PREFIX)) return plaintext; // already sealed

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

/**
 * Decrypt a value. Plaintext (legacy) values pass through untouched.
 * Returns null when a sealed value cannot be opened — wrong key, or tampering.
 */
export function decryptSecret(value: string): string | null {
  if (!value.startsWith(PREFIX)) return value;

  const secret = rawSecret();
  if (!secret) return null;

  const parts = value.slice(PREFIX.length).split('.');
  if (parts.length !== 3) return null;

  try {
    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const payload = Buffer.from(parts[2], 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(secret), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);
    return decrypted.toString('utf-8');
  } catch {
    // GCM authentication failure: wrong key or modified ciphertext
    return null;
  }
}

/** True when a stored value is already sealed. */
export function isSealed(value: string): boolean {
  return value.startsWith(PREFIX);
}
