/** Check the local Ahenk API without credentials or database mutations. */
import { pathToFileURL } from 'node:url';

export function parseOptions(argv) {
  const options = { port: 4000, timeoutMs: 3000 };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--port', '--timeout-ms'].includes(flag) || !/^\d+$/.test(value ?? '')) {
      throw new Error('Usage: node scripts/check-health.mjs [--port 4000] [--timeout-ms 3000]');
    }
    const number = Number(value);
    if (flag === '--port' && (number < 1 || number > 65535)) throw new Error('Port must be 1-65535');
    if (flag === '--timeout-ms' && (number < 100 || number > 30000)) throw new Error('Timeout must be 100-30000 ms');
    options[flag === '--port' ? 'port' : 'timeoutMs'] = number;
  }
  return options;
}

export async function checkHealth({ port = 4000, timeoutMs = 3000 } = {}, request = fetch) {
  try {
    const response = await request(`http://127.0.0.1:${port}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return false;
    const payload = await response.json();
    return payload?.status === 'ok';
  } catch {
    return false;
  }
}

export async function main(argv = process.argv.slice(2), request = fetch) {
  let options;
  try { options = parseOptions(argv); }
  catch (error) { console.error(error.message); return 2; }
  const healthy = await checkHealth(options, request);
  if (healthy) console.log(`Ahenk API ready at http://127.0.0.1:${options.port}/health`);
  else console.error('Ahenk API unavailable or returned an unexpected health status.');
  return healthy ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
