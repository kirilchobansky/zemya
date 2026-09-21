/**
 * The site's origin, read from one place. Precedence: the SITE_URL environment variable
 * (Vercel project settings), then a local `.env`, then `.env.example`, whose committed
 * value is the default. Node-only: vite.config.ts and react-router.config.ts import it
 * and hand the result to the app as a build-time constant (see app/lib/site.ts).
 */
import { existsSync, readFileSync } from 'node:fs';

function fromEnvFile(path) {
  if (!existsSync(path)) return undefined;
  const line = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .find(l => /^\s*SITE_URL\s*=/.test(l));
  return line?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '') || undefined;
}

export function siteUrl() {
  const raw = process.env.SITE_URL || fromEnvFile('.env') || fromEnvFile('.env.example');
  if (!raw) throw new Error('SITE_URL is not set and .env.example has no default.');
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new Error(`SITE_URL must be https (got ${raw}).`);
  }
  return url.origin;
}
