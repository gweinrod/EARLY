/**
 * JWT auth helpers (HS256). Session token in httpOnly cookie — not localStorage.
 */
import crypto from 'node:crypto';

const COOKIE_NAME = 'early_auth';
const DEFAULT_TTL_SEC = 60 * 60 * 24 * 7; // 7 days

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlJson(obj) {
  return b64url(JSON.stringify(obj));
}

function parseB64urlJson(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const json = Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString(
    'utf8',
  );
  return JSON.parse(json);
}

export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Set JWT_SECRET (min 16 chars) in production');
  }
  return 'early-dev-jwt-secret-change-me';
}

export function signToken({ userId, firstName, jti }, ttlSec = DEFAULT_TTL_SEC) {
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = b64urlJson({
    sub: userId,
    name: firstName,
    jti,
    exp: Math.floor(Date.now() / 1000) + ttlSec,
  });
  const data = `${header}.${payload}`;
  const sig = crypto.createHmac('sha256', getJwtSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const data = `${header}.${payload}`;
  const expected = crypto.createHmac('sha256', getJwtSecret()).update(data).digest('base64url');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let body;
  try {
    body = parseB64urlJson(payload);
  } catch {
    return null;
  }
  if (!body.sub || !body.jti || !body.exp) return null;
  if (body.exp < Math.floor(Date.now() / 1000)) return null;
  return {
    userId: String(body.sub),
    firstName: String(body.name ?? 'Anonymous'),
    jti: String(body.jti),
  };
}

export function parseCookieHeader(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

export function authCookieOptions(maxAgeSec = DEFAULT_TTL_SEC) {
  const secure = process.env.NODE_ENV === 'production';
  return {
    name: COOKIE_NAME,
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: maxAgeSec,
    secure,
  };
}

export { COOKIE_NAME, DEFAULT_TTL_SEC };
