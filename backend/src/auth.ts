import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { BASIC_AUTH_USER, BASIC_AUTH_PASSWORD } from './config.js';

/**
 * Basic Auth middleware.
 * If BASIC_AUTH_PASSWORD is not configured, authentication is bypassed (dev mode).
 * If configured, prompts HTTP Basic Authentication with constant-time comparison.
 */
export function basicAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const expectedPass = process.env.BASIC_AUTH_PASSWORD || BASIC_AUTH_PASSWORD;
  const expectedUser = process.env.BASIC_AUTH_USER || BASIC_AUTH_USER || 'admin';

  if (!expectedPass) {
    return next();
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="PHEV Tracker", charset="UTF-8"');
    return res.status(401).send('Authentifizierung erforderlich (Benutzername und Passwort eingeben).');
  }

  const base64Credentials = authHeader.slice(6);
  let credentials = '';
  try {
    credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');
  } catch {
    res.setHeader('WWW-Authenticate', 'Basic realm="PHEV Tracker", charset="UTF-8"');
    return res.status(401).send('Ungültige Anmeldedaten.');
  }

  const colonIndex = credentials.indexOf(':');
  if (colonIndex === -1) {
    res.setHeader('WWW-Authenticate', 'Basic realm="PHEV Tracker", charset="UTF-8"');
    return res.status(401).send('Ungültiges Anmeldeformat.');
  }

  const user = credentials.substring(0, colonIndex);
  const pass = credentials.substring(colonIndex + 1);

  const userMatch = safeCompare(user, expectedUser);
  const passMatch = safeCompare(pass, expectedPass);

  if (!userMatch || !passMatch) {
    res.setHeader('WWW-Authenticate', 'Basic realm="PHEV Tracker", charset="UTF-8"');
    return res.status(401).send('Ungültiger Benutzername oder falsches Passwort.');
  }

  return next();
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}
