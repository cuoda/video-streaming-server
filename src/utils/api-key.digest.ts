import crypto from 'crypto';

const REDIS_KEY_SECRET = process.env.CLERK_SECRET_KEY ?? '';

if (!REDIS_KEY_SECRET) {
  throw new Error('Missing environment variable: CLERK_SECRET_KEY');
}

export function digest(plain: string) {
  return crypto
    .createHmac('sha256', REDIS_KEY_SECRET)
    .update(plain)
    .digest('hex');
}
