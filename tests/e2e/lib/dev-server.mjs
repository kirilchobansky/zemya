/**
 * `react-router dev`, spawned on a free port for the areas that need the DEV-only test seams
 * (window.__zemya, __zemyaQuiz, __zemyaView — stripped from the production bundle by
 * import.meta.env.DEV, by design). Readiness is "a real HTTP request to the address
 * succeeded", never anything parsed from the server's output.
 */
import { createServer as createNetServer } from 'node:net';
import { spawn } from 'node:child_process';

const STARTUP_TIMEOUT_MS = Number(process.env.DEV_STARTUP_TIMEOUT_MS || 60_000);

/** Strip ANSI escapes so captured output in an error message is readable. */
const stripAnsi = s => s.replace(/\x1b\[[0-9;]*m/g, '');

/** Ask the OS for a free port rather than guessing one. */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, timeoutMs, output) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not accepting connections yet */
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`dev server did not come up within ${timeoutMs}ms polling ${url}\n${stripAnsi(output.text)}`);
}

/** Starts the dev server; resolves to { base, stop }. `base` ends with a slash. */
export async function startDevServer() {
  const port = await getFreePort();
  const host = '127.0.0.1';
  const output = { text: '' };
  const child = spawn('npx', ['react-router', 'dev', '--host', host, '--port', String(port), '--strictPort'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }
  });
  child.stdout.on('data', d => { output.text += d; });
  child.stderr.on('data', d => { output.text += d; });
  const stop = () => {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* already dead, or no process groups on this platform */
    }
    child.kill('SIGKILL');
  };
  const base = `http://${host}:${port}/`;
  try {
    await waitForServer(base, STARTUP_TIMEOUT_MS, output);
  } catch (error) {
    stop();
    throw error;
  }
  return { base, stop };
}
