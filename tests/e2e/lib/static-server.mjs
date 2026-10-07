/**
 * Serves build/client statically, the way Vercel will: directory index.html fallback, HTTP Range
 * for world.pmtiles. Shared by smoke.mjs and perf.mjs.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

export const BUILD_ROOT = resolve(process.cwd(), 'build', 'client');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.data': 'text/x-script',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pmtiles': 'application/octet-stream',
  '.pbf': 'application/x-protobuf',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json'
};

export function requireBuild(hint = 'run `npm run build` first.') {
  if (existsSync(BUILD_ROOT)) return;
  console.error(`build/client not found — ${hint}`);
  process.exit(1);
}

/** Starts the server on `port`; resolves to { server, base }. */
export async function startStaticServer(port) {
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    // Vercel serves its analytics scripts itself (/_vercel/*); no other host has them, so answer
    // with an empty script instead of a 404 that the console-error check would (rightly) flag.
    if (url.startsWith('/_vercel/')) {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end('/* provided by Vercel at runtime */');
      return;
    }
    for (const candidate of [join(BUILD_ROOT, url), join(BUILD_ROOT, url, 'index.html')]) {
      if (!candidate.startsWith(BUILD_ROOT)) break;
      try {
        const info = await stat(candidate);
        if (!info.isFile()) continue;
        const body = await readFile(candidate);
        const type = MIME[extname(candidate)] || 'application/octet-stream';
        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
        if (range) {
          const start = Number(range[1]);
          const end = Math.min(range[2] ? Number(range[2]) : body.length - 1, body.length - 1);
          res.writeHead(206, {
            'content-type': type,
            'content-range': `bytes ${start}-${end}/${body.length}`,
            'content-length': end - start + 1,
            'accept-ranges': 'bytes'
          });
          res.end(body.subarray(start, end + 1));
          return;
        }
        res.writeHead(200, { 'content-type': type, 'content-length': body.length, 'accept-ranges': 'bytes' });
        res.end(body);
        return;
      } catch {
        /* try the next candidate */
      }
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  await new Promise(done => server.listen(port, done));
  return { server, base: `http://127.0.0.1:${port}` };
}
