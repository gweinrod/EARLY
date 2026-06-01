import crypto from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import pg from 'pg';
import {
  clearAuthCookieHeader,
  readAuthToken,
  setAuthCookieHeader,
  signToken,
  verifyToken,
} from './jwt';

function pool(): pg.Pool | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return new pg.Pool({ connectionString: url });
}

async function findOrCreateUser(client: pg.Pool, firstName: string) {
  const name = firstName.trim();
  if (!name) return null;
  const { rows: found } = await client.query(
    `SELECT id, first_name FROM users WHERE LOWER(TRIM(first_name)) = LOWER(TRIM($1)) LIMIT 1`,
    [name],
  );
  if (found[0]) return found[0] as { id: string; first_name: string };
  const { rows: created } = await client.query(
    `INSERT INTO users (first_name) VALUES ($1) RETURNING id, first_name`,
    [name],
  );
  return created[0] as { id: string; first_name: string };
}

async function isRevoked(client: pg.Pool, jti: string): Promise<boolean> {
  const { rows } = await client.query(`SELECT 1 FROM revoked_tokens WHERE jti = $1 LIMIT 1`, [jti]);
  return rows.length > 0;
}

async function resolveAuth(client: pg.Pool, req: VercelRequest) {
  const token = readAuthToken(req);
  if (!token) return null;
  const claims = verifyToken(token);
  if (!claims || (await isRevoked(client, claims.jti))) return null;
  return claims;
}

function notConfigured(res: VercelResponse): void {
  res.status(503).json({
    error: 'auth_not_configured',
    hint: 'Set DATABASE_URL and run server/schema.sql (users + revoked_tokens).',
  });
}

export async function handleLogin(req: VercelRequest, res: VercelResponse): Promise<void> {
  const client = pool();
  if (!client) {
    notConfigured(res);
    return;
  }
  const firstName = String(req.body?.firstName ?? req.body?.name ?? '');
  try {
    const user = await findOrCreateUser(client, firstName);
    if (!user) {
      res.status(400).json({ error: 'name_required' });
      return;
    }
    const jti = crypto.randomUUID();
    const token = signToken({
      userId: user.id,
      firstName: user.first_name,
      jti,
    });
    setAuthCookieHeader(res, token);
    res.status(200).json({
      userId: user.id,
      firstName: user.first_name,
      displayName: user.first_name,
    });
  } catch (e) {
    res.status(500).json({ error: 'login_failed', message: String(e) });
  } finally {
    await client.end();
  }
}

export async function handleLogout(req: VercelRequest, res: VercelResponse): Promise<void> {
  const client = pool();
  if (!client) {
    clearAuthCookieHeader(res);
    res.status(200).json({ ok: true });
    return;
  }
  try {
    const claims = await resolveAuth(client, req);
    if (claims) {
      await client.query(
        `INSERT INTO revoked_tokens (jti, user_id) VALUES ($1, $2) ON CONFLICT (jti) DO NOTHING`,
        [claims.jti, claims.userId],
      );
    }
    clearAuthCookieHeader(res);
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'logout_failed', message: String(e) });
  } finally {
    await client.end();
  }
}

export async function handleMe(req: VercelRequest, res: VercelResponse): Promise<void> {
  const client = pool();
  if (!client) {
    notConfigured(res);
    return;
  }
  try {
    const claims = await resolveAuth(client, req);
    if (!claims) {
      res.status(401).json({ error: 'not_authenticated' });
      return;
    }
    const { rows } = await client.query(
      `SELECT id, first_name FROM users WHERE id = $1 LIMIT 1`,
      [claims.userId],
    );
    const user = rows[0] as { id: string; first_name: string } | undefined;
    if (!user) {
      clearAuthCookieHeader(res);
      res.status(401).json({ error: 'not_authenticated' });
      return;
    }
    res.status(200).json({
      userId: user.id,
      firstName: user.first_name,
      displayName: user.first_name,
    });
  } catch (e) {
    res.status(500).json({ error: 'auth_failed', message: String(e) });
  } finally {
    await client.end();
  }
}
