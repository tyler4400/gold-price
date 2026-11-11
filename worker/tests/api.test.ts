import { readFileSync, readdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { historyBounds } from '../index.ts';
import type { PriceRecord } from '../../ingest/core.ts';
import { IngestError } from '../../ingest/core.ts';
import { main } from '../../ingest/cli.ts';
import { collect } from '../../ingest/pipeline.ts';
import { CSS_SOURCE_URL } from '../../ingest/adapters/chow-sang-sang.ts';

// Generated per test run, never an operational credential or a value written to disk.
const token = crypto.randomUUID();
const origin = 'http://localhost';
let mf: Miniflare;
let noSecret: Miniflare;
let db: Awaited<ReturnType<Miniflare['getD1Database']>>;
const sample = (overrides: Partial<PriceRecord> = {}): PriceRecord => ({
  date: '2026-01-02', item_key: 'sge_au9999', price: 800.10, unit: 'CNY/g',
  source_url: 'https://finance.sina.com.cn/futures/quotes/AU9999.shtml',
  fetched_at: '2026-01-02T09:00:00.000Z', ...overrides,
});
function post(records: unknown, credential: string | null = token) {
  return mf.dispatchFetch(`${origin}/api/ingest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(credential === null ? {} : { Authorization: `Bearer ${credential}` }) },
    body: JSON.stringify({ records }),
  });
}
async function rows() { return (await db.prepare('SELECT * FROM daily_prices ORDER BY date, item_key').all()).results; }
async function seed(records: PriceRecord[]) {
  await db.batch(records.map(r => db.prepare('INSERT INTO daily_prices VALUES (?, ?, ?, ?, ?, ?)')
    .bind(r.date, r.item_key, r.price, r.unit, r.source_url, r.fetched_at)));
}
async function expectError(response: Awaited<ReturnType<typeof post>>, status: number) {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error: { code: expect.any(String), message: expect.any(String) } });
  expect(response.headers.get('access-control-allow-origin')).toBeNull();
}

beforeAll(async () => {
  const bundle = await build({ entryPoints: ['worker/index.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', external: ['node:crypto'] });
  const script = bundle.outputFiles[0]?.text;
  if (!script) throw new Error('Missing worker bundle');
  const options = {
    name: 'test-worker', modules: true, script, compatibilityDate: '2026-09-09', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'],
    serviceBindings: { ASSETS: () => new Response('<html>static assets</html>', { headers: { 'Content-Type': 'text/html' } }) },
    outboundService: () => { throw new Error('Offline worker tests forbid external network access'); },
  };
  // Match Wrangler's pinned runtime; v5 provides the adapter for the documented v4 options.
  mf = new Miniflare(convertV4MiniflareOptions({ ...options, bindings: { INGEST_TOKEN: token } }));
  noSecret = new Miniflare(convertV4MiniflareOptions(options));
  db = await mf.getD1Database('DB');
  for (const file of readdirSync('migrations').filter(file => file.endsWith('.sql')).sort()) {
    const statements = readFileSync(`migrations/${file}`, 'utf8').split(';').map(s => s.trim()).filter(Boolean);
    await db.batch(statements.map(sql => db.prepare(sql)));
  }
});
beforeEach(async () => { await db.prepare('DELETE FROM daily_prices').run(); });
afterAll(async () => { await Promise.all([mf?.dispose(), noSecret?.dispose()]); });

it('healthz and static assets work; all unknown API paths stay JSON, methods are restricted', async () => {
  const health = await mf.dispatchFetch(`${origin}/healthz`);
  expect(health.status).toBe(200);
  expect(await health.json()).toEqual({ status: 'ok', stage: 'api' });
  expect(await (await mf.dispatchFetch(`${origin}/`)).text()).toContain('static assets');
  for (const path of ['/api', '/api/missing', '/api/subscribers', '/api/alert_rules']) {
    await expectError(await mf.dispatchFetch(`${origin}${path}`), 404);
  }
  for (const path of ['/healthz', '/api/latest', '/api/history']) {
    await expectError(await mf.dispatchFetch(`${origin}${path}`, { method: 'POST' }), 405);
  }
  await expectError(await mf.dispatchFetch(`${origin}/api/ingest`), 405);
  await expectError(await mf.dispatchFetch(`${origin}/api/ingest`, { method: 'OPTIONS', headers: { Origin: 'https://untrusted.example' } }), 405);
});

it('missing, wrong, different-length and query-only tokens are 401; unconfigured secret is 503', async () => {
  for (const credential of [null, '', 'wrong', `${token}x`, 'a'.repeat(256)]) await expectError(await post([sample()], credential), 401);
  await expectError(await mf.dispatchFetch(`${origin}/api/ingest?token=${token}`, { method: 'POST' }), 401);
  await expectError(await noSecret.dispatchFetch(`${origin}/api/ingest`, { method: 'POST' }), 503);
  expect(await rows()).toEqual([]);
});

it('inserts, equal-timestamp retries, newer updates and older ignores produce exact counts', async () => {
  const initial = await post([sample(), sample({ date: '2026-01-01' })]);
  expect(initial.status).toBe(200);
  expect(await initial.json()).toEqual({ accepted: 2, updated: 0, ignored: 0 });
  expect(await (await post([sample()])).json()).toEqual({ accepted: 1, updated: 1, ignored: 0 });
  expect(await (await post([sample({ price: 810.35, fetched_at: '2026-01-02T10:00:00Z' })])).json()).toEqual({ accepted: 1, updated: 1, ignored: 0 });
  const mixed = await post([
    sample({ price: 700 }),
    sample({ date: '2026-01-01', price: 750, fetched_at: '2026-01-03T00:00:00.000Z' }),
    sample({ date: '2026-01-03', price: 900, fetched_at: '2026-01-03T00:00:00.000Z' }),
  ]);
  expect(await mixed.json()).toEqual({ accepted: 2, updated: 1, ignored: 1 });
  expect(await rows()).toEqual([
    sample({ date: '2026-01-01', price: 750, fetched_at: '2026-01-03T00:00:00.000Z' }),
    sample({ price: 810.35, fetched_at: '2026-01-02T10:00:00.000Z' }),
    sample({ date: '2026-01-03', price: 900, fetched_at: '2026-01-03T00:00:00.000Z' }),
  ]);
});

it('normalizes fractional ISO seconds before comparing timestamps and rounds to cents', async () => {
  expect((await post([sample({ fetched_at: '2026-01-02T09:00:00Z', price: 1.005 })])).status).toBe(200);
  expect(await (await post([sample({ fetched_at: '2026-01-02T09:00:00.1Z', price: 1.235 })])).json()).toEqual({ accepted: 1, updated: 1, ignored: 0 });
  expect(await (await post([sample({ fetched_at: '2026-01-02T09:00:00Z' })])).json()).toEqual({ accepted: 0, updated: 0, ignored: 1 });
  expect(await rows()).toEqual([sample({ fetched_at: '2026-01-02T09:00:00.100Z', price: 1.24 })]);
});

it('six same-day brand uploads upsert one row; replaying an older run cannot roll back its price', async () => {
  const brand = sample({ item_key: 'chow_sang_sang_jewelry', source_url: CSS_SOURCE_URL, price: 1243 });
  for (let run = 0; run < 6; run++) {
    const record = { ...brand, price: brand.price + run, fetched_at: `2026-01-02T09:${run}0:00.000Z` };
    expect(await (await post([record])).json()).toEqual({ accepted: 1, updated: run === 0 ? 0 : 1, ignored: 0 });
    expect(await rows()).toEqual([record]);
  }
  expect(await (await post([brand])).json()).toEqual({ accepted: 0, updated: 0, ignored: 1 });
  expect(await rows()).toEqual([{ ...brand, price: 1248, fetched_at: '2026-01-02T09:50:00.000Z' }]);
});

it.each(['timeout', 'network', 'challenge', 'price'] as const)('a failed brand (%s) is omitted by the CLI and preserves existing prices in D1', async code => {
  const brand = sample({ item_key: 'chow_sang_sang_jewelry', source_url: CSS_SOURCE_URL, price: 1243 });
  const existing = [{ ...brand, date: '2026-01-01' }, brand];
  await seed(existing);
  let uploads = 0;
  const exitCode = await main(['--upload'], { WORKER_BASE_URL: origin, INGEST_TOKEN: token }, {
    collect: () => collect(async url => {
      if (url === CSS_SOURCE_URL) throw new IngestError(code, '周生生抓取失败');
      if (url.includes('/page/board')) return readFileSync('ingest/fixtures/china.json', 'utf8');
      throw new IngestError('network', '其它源不可用');
    }, () => new Date('2026-01-02T10:00:00Z')),
    request: async (url, options) => {
      uploads++;
      const body = JSON.parse(options?.body ?? '{}');
      expect(body.records).toHaveLength(2);
      expect(body.records.every((r: PriceRecord) => r.item_key !== brand.item_key)).toBe(true);
      const response = await mf.dispatchFetch(url, { method: options?.method, headers: options?.headers, body: options?.body });
      expect(response.status).toBe(200);
      return response.text();
    },
    print: () => {},
  });
  expect(exitCode).toBe(0);
  expect(uploads).toBe(1);
  const stored = await rows();
  expect(stored).toHaveLength(4);
  expect(stored.filter(r => r.item_key === brand.item_key)).toEqual(existing);
});

it('accepts the Chow Sang Sang aggregator fallback source, but not for other official-source items', async () => {
  const fallback = sample({ item_key: 'chow_sang_sang_jewelry', source_url: 'https://www.huangjinjiage.cn/pinpaijinjia.html', price: 1212 });
  expect(await (await post([fallback])).json()).toEqual({ accepted: 1, updated: 0, ignored: 0 });
  expect(await rows()).toEqual([fallback]);
  await expectError(await post([sample({ item_key: 'lukfook_jewelry', source_url: 'https://www.huangjinjiage.cn/pinpaijinjia.html' })]), 400);
});

it('concurrent upserts keep the newest timestamp with consistent counts', async () => {
  const responses = await Promise.all([
    post([sample({ price: 950, fetched_at: '2026-01-02T10:00:00Z' })]), post([sample()]),
  ]);
  let inserts = 0;
  for (const response of responses) {
    expect(response.status).toBe(200);
    const counts = await response.json() as { accepted: number; updated: number; ignored: number };
    expect(counts.accepted + counts.ignored).toBe(1);
    expect(counts.updated).toBeLessThanOrEqual(counts.accepted);
    inserts += counts.accepted - counts.updated;
  }
  expect(inserts).toBe(1);
  expect(await rows()).toEqual([sample({ price: 950, fetched_at: '2026-01-02T10:00:00.000Z' })]);
});

const invalidRecords: unknown[] = [
  null, {}, { ...sample(), extra: true }, { ...sample(), unit: 'USD/g' },
  { ...sample(), item_key: "sge_au9999'; DROP TABLE daily_prices; --" },
  ...[0, -1, null, '800', 1e100, 0.001].map(price => ({ ...sample(), price })),
  ...['2026-02-30', '2026-1-2', '1999-12-31', '2099-01-01'].map(date => ({ ...sample(), date })),
  ...['http://finance.sina.com.cn/futures/quotes/AU9999.shtml', 'https://evil.example', 'https://finance.sina.com.cn@evil.example/', 'https://www.lukfook.com/sc/page/goldprice'].map(source_url => ({ ...sample(), source_url })),
  ...['bad', '2026-01-02', '2026-02-30T00:00:00Z', '2026-01-02T24:00:00Z', '2026-01-02T09:00:00+00:00', '2099-01-01T00:00:00Z'].map(fetched_at => ({ ...sample(), fetched_at })),
];
it.each(invalidRecords.map((record, index) => [index, record] as const))('invalid record case %i rejects the whole batch', async (_index, invalid) => {
  await seed([sample({ date: '2026-01-01' })]);
  await expectError(await post([sample(), invalid]), 400);
  expect(await rows()).toEqual([sample({ date: '2026-01-01' })]);
});

it('rejects empty, oversized, duplicate, malformed and non-JSON requests before writes', async () => {
  for (const records of [[], Array.from({ length: 101 }, () => sample()), [sample(), sample({ price: 900 })]]) {
    await expectError(await post(records), 400);
  }
  for (const body of ['{', '{}', '{"records":[],"extra":true}', '[1]']) {
    await expectError(await mf.dispatchFetch(`${origin}/api/ingest`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body }), 400);
  }
  await expectError(await mf.dispatchFetch(`${origin}/api/ingest`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: '{}' }), 415);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  await expectError(await mf.dispatchFetch(`${origin}/api/ingest`, { method: 'POST', headers, body: ' '.repeat(65537) }), 413);
  // A chunked stream has no Content-Length; the reader must enforce the byte limit itself.
  await expectError(await mf.dispatchFetch(`${origin}/api/ingest`, { method: 'POST', headers, body: new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(40000)); controller.enqueue(new Uint8Array(40000)); controller.close();
  } }), duplex: 'half' }), 413);
  expect(await rows()).toEqual([]);
});

it('D1 failure rolls back the entire statement/batch and returns a sanitized error', async () => {
  await seed([sample({ date: '2026-01-01' })]);
  await db.prepare(`CREATE TRIGGER reject_test BEFORE INSERT ON daily_prices WHEN NEW.date = '2026-01-03'
    BEGIN SELECT RAISE(ABORT, 'private database diagnostic'); END`).run();
  try {
    const response = await post([sample(), sample({ date: '2026-01-03', fetched_at: '2026-01-03T09:00:00Z' })]);
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).not.toContain('private database diagnostic');
    expect(JSON.parse(body)).toHaveProperty('error.code', 'service_unavailable');
    expect(await rows()).toEqual([sample({ date: '2026-01-01' })]);
  } finally { await db.prepare('DROP TRIGGER reject_test').run(); }
});

it('latest uses each item’s latest and prior available dates, with exact cent differences', async () => {
  expect(await (await mf.dispatchFetch(`${origin}/api/latest`)).json()).toEqual({ items: [] });
  const china = { item_key: 'china_gold_base', source_url: 'https://www.chnau99999.com/page/goldPrice' } as const;
  await seed([
    sample({ date: '2026-01-05', price: 800.10 }), sample({ date: '2026-01-02', price: 800.20 }), sample({ date: '2026-01-01', price: 500 }),
    sample({ ...china, date: '2026-01-03', price: 101.01 }), sample({ ...china, date: '2026-01-01', price: 100 }),
    sample({ item_key: 'xau_cny_g', source_url: 'https://finance.sina.com.cn/futures/quotes/XAU.shtml', date: '2026-01-01' }),
  ]);
  const response = await mf.dispatchFetch(`${origin}/api/latest`);
  expect(response.status).toBe(200);
  const { items } = await response.json() as { items: Array<PriceRecord & { previous_date: string | null; change: number | null; change_percent: number | null }> };
  expect(items).toHaveLength(3);
  expect(items.find(r => r.item_key === 'sge_au9999')).toMatchObject({ date: '2026-01-05', previous_date: '2026-01-02', change: -0.10, change_percent: -0.01 });
  expect(items.find(r => r.item_key === 'china_gold_base')).toMatchObject({ date: '2026-01-03', previous_date: '2026-01-01', change: 1.01, change_percent: 1.01 });
  expect(items.find(r => r.item_key === 'xau_cny_g')).toMatchObject({ previous_date: null, change: null, change_percent: null });
});

function shift(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
describe('history', () => {
  it.each([7, 30, 90, 365])('%id uses inclusive calendar boundaries, ordered sparse points and independent items', async days => {
    const to = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
    const from = shift(to, -(days - 1));
    const included = [sample({ date: from, price: 700 }), sample({ date: shift(to, -2), price: 750 }), sample({ date: to, price: 800 })];
    await seed([included[2]!, sample({ date: shift(from, -1) }), included[0]!, included[1]!, sample({ date: shift(to, 1) }), sample({ date: to, item_key: 'china_gold_base' })]);
    const response = await mf.dispatchFetch(`${origin}/api/history?item=sge_au9999&range=${days}d`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ item_key: 'sge_au9999', unit: 'CNY/g', range: `${days}d`, from, to,
      points: included.map(({ date, price, source_url, fetched_at }) => ({ date, price, source_url, fetched_at })) });
  });
  it('defaults to 30d and returns empty data for a known item', async () => {
    const response = await mf.dispatchFetch(`${origin}/api/history?item=caibai_jewelry`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ item_key: 'caibai_jewelry', unit: 'CNY/g', range: '30d', points: [] });
  });
  it.each(['', '?range=7d', '?item=invalid', '?item=sge_au9999&range=1d', '?item=sge_au9999&range=', '?item=sge_au9999&range=30D'])('rejects invalid query %s', async query => {
    await expectError(await mf.dispatchFetch(`${origin}/api/history${query}`), 400);
  });
  it('Shanghai midnight, leap day and year rollover have exact calendar boundaries', () => {
    expect(historyBounds('7d', new Date('2026-12-31T16:00:00Z'))).toEqual({ from: '2026-12-26', to: '2027-01-01' });
    expect(historyBounds('7d', new Date('2026-12-31T15:59:59Z'))).toEqual({ from: '2026-12-25', to: '2026-12-31' });
    expect(historyBounds('30d', new Date('2024-02-29T16:00:00Z'))).toEqual({ from: '2024-02-01', to: '2024-03-01' });
  });
});

it('migration creates reserved tables with unique email, foreign keys and unique rules', async () => {
  const columns = await db.prepare('PRAGMA table_info(subscribers)').all<{ name: string }>();
  expect(columns.results.map(r => r.name)).toEqual(['id', 'email', 'email_normalized', 'status', 'verified_at', 'verification_token_hash', 'verification_expires_at', 'created_at', 'updated_at']);
  await expect(db.prepare("INSERT INTO alert_rules (id, subscriber_id, item_key, lower_price, created_at, updated_at) VALUES ('rule', 'missing', 'sge_au9999', 1, 'now', 'now')").run()).rejects.toThrow();
  await db.prepare("INSERT INTO subscribers (id, email, email_normalized, created_at, updated_at) VALUES ('test', 'Test@example.com', 'test@example.com', 'now', 'now')").run();
  try {
    await expect(db.prepare("INSERT INTO subscribers (id, email, email_normalized, created_at, updated_at) VALUES ('other', 'test@example.com', 'test@example.com', 'now', 'now')").run()).rejects.toThrow();
    await db.prepare("INSERT INTO alert_rules (id, subscriber_id, item_key, lower_price, created_at, updated_at) VALUES ('rule', 'test', 'sge_au9999', 1, 'now', 'now')").run();
    await expect(db.prepare("INSERT INTO alert_rules (id, subscriber_id, item_key, upper_price, created_at, updated_at) VALUES ('other', 'test', 'sge_au9999', 2, 'now', 'now')").run()).rejects.toThrow();
  } finally { await db.prepare("DELETE FROM subscribers WHERE id = 'test'").run(); }
});


it('accepts the maximum 100 distinct records in a single transaction', async () => {
  const records = Array.from({ length: 100 }, (_, index) => sample({ date: shift('2025-01-01', index) }));
  const response = await post(records);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ accepted: 100, updated: 0, ignored: 0 });
  expect(await rows()).toHaveLength(100);
});
