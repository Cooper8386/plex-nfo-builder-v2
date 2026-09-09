import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export type ProviderMode = 'normal' | 'rate-limit' | 'hang';

export async function providerDouble(provider: 'tvdb' | 'tmdb' | 'fanart', responses: Record<string, unknown> = {}) {
  let mode: ProviderMode = 'normal';
  let inFlight = 0;
  let peak = 0;
  const requests: string[] = [];
  const server = createServer((request, response) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    response.once('close', () => inFlight--);
    const key = `${request.method} ${request.url}`;
    requests.push(key);
    if (mode === 'hang') return;
    response.setHeader('Content-Type', 'application/json');
    if (mode === 'rate-limit') {
      response.writeHead(429, { 'Retry-After': '1' });
      response.end(JSON.stringify({ error: 'rate limited' }));
      return;
    }
    const payload = responses[key];
    response.statusCode = payload === undefined ? 404 : 200;
    response.end(JSON.stringify(payload ?? { error: 'No canned response', provider }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests, setMode: (value: ProviderMode) => { mode = value; },
    get inFlight() { return inFlight; }, get peakInFlight() { return peak; },
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}
