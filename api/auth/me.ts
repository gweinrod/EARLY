import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleMe } from '../lib/auth-handlers';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  await handleMe(req, res);
}
