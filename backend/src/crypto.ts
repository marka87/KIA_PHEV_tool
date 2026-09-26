import crypto from 'node:crypto';
import { ENCRYPTION_KEY } from './config.js';

function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || ENCRYPTION_KEY || 'phev-tracker-internal-encryption-key-salt-2026';
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypts a sensitive string using AES-256-GCM.
 * Output format: "enc:v1:<iv_hex>:<tag_hex>:<ciphertext_hex>"
 */
export function encryptString(plaintext: string): string {
  if (!plaintext) return '';
  if (plaintext.startsWith('enc:v1:')) return plaintext; // already encrypted

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `enc:v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts an AES-256-GCM encrypted string.
 * Gracefully returns unencrypted plaintext if string is not encrypted.
 */
export function decryptString(encryptedText: string): string {
  if (!encryptedText) return '';
  if (!encryptedText.startsWith('enc:v1:')) {
    // Legacy / unencrypted plaintext fallback
    return encryptedText;
  }

  const parts = encryptedText.split(':');
  if (parts.length !== 5) {
    throw new Error('Ungültiges Format für verschlüsselten Wert');
  }

  const iv = Buffer.from(parts[2], 'hex');
  const tag = Buffer.from(parts[3], 'hex');
  const ciphertext = Buffer.from(parts[4], 'hex');

  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}
