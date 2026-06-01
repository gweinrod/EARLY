import crypto from 'node:crypto';

const COOKIE_NAME = 'early_auth';
const DEFAULT_TTL_SEC = 60 * 60 * 24 * 7;

function b64urlJson(obj: object): string {
  return Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function parseB64urlJson(str: string): Record<string, unknown> {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const json = Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString(
    'utf8',
  );
  return JSON.parse(json) as Record<string, unknown>;
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (process.env.VERCEL_ENV === 'production') {
    throw new Error('JWT_SECRET required in production');
  }
  return 'early-dev-jwt-secret-change-me';
}

export function signToken(payload: {
  userId: string;
  firstName: string;
  jti: string;
}): string {
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const body = b64urlJson({
    sub: payload.userId,
    name: payload.firstName,
    jti: payload.jti,
    exp: Math.floor(Date.now() / 1000) + DEFAULT_TTL_SEC,
  });
  const data = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', getJwtSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyToken(token: string): {
  userId: string;
  firstName: string;
  jti: string;
} | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const data = `${header}.${payload}`;
  const expected = crypto.createHmac('sha256', getJwtSecret()).update(data).digest('base64url');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let body: Record<string, unknown>;
  try {
    body = parseB64urlJson(payload);
  } catch {
    return null;
  }
  const exp = body.exp;
  if (typeof exp !== 'number' || exp < Math.floor(Date.now() / 1000)) return null;
  if (!body.sub || !body.jti) return null;
  return {
    userId: String(body.sub),
    firstName: String(body.name ?? 'Anonymous'),
    jti: String(body.jti),
  };
}

export function parseCookieHeader(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function readAuthToken(req: {
  headers: { cookie?: string; authorization?: string };
}): string | null {
  const cookies = parseCookieHeader(req.headers.cookie);
  if (cookies[COOKIE_NAME]) return cookies[COOKIE_NAME];
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

export function setAuthCookieHeader(res: { setHeader: (k: string, v: string) => void }, token: string): void {
  const secure = process.env.VERCEL_ENV === 'production';
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    `Max-Age=${DEFAULT_TTL_SEC}`,
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearAuthCookieHeader(res: { setHeader: (k: string, v: string) => void }): void {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}
