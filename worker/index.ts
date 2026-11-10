import { timingSafeEqual } from 'node:crypto';
import type { D1Database } from '@cloudflare/workers-types';
import { shanghaiDate } from '../ingest/core.ts';
import type { PriceRecord } from '../ingest/core.ts';
import { ApiError, isItem, readJson, validateRecords } from './validation.ts';

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DB: D1Database;
  INGEST_TOKEN?: string;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}
async function authenticate(request: Request, secret: string | undefined): Promise<void> {
  if (!secret?.trim()) throw new ApiError(503, 'ingest_unavailable', '尚未配置上报密钥');
  const supplied = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
  // Compare fixed-size digests with the runtime's constant-time primitive, including unequal token lengths.
  const encoder = new TextEncoder();
  const [expectedHash, suppliedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(secret)),
    crypto.subtle.digest('SHA-256', encoder.encode(supplied)),
  ]);
  if (!timingSafeEqual(new Uint8Array(expectedHash), new Uint8Array(suppliedHash))) {
    throw new ApiError(401, 'unauthorized', '上报凭据缺失或无效');
  }
}

async function ingest(request: Request, env: Env): Promise<Response> {
  await authenticate(request, env.INGEST_TOKEN);
  const records = validateRecords(await readJson(request));
  const payload = JSON.stringify(records);
  // Both the existence snapshot and conditional upsert run in ONE D1 transaction.
  // RETURNING counts only accepted rows, so concurrent writers cannot corrupt the summary.
  const [before, written] = await env.DB.batch<{ date: string; item_key: string }>([
    env.DB.prepare(`SELECT date, item_key FROM daily_prices WHERE (date, item_key) IN (
      SELECT json_extract(value, '$.date'), json_extract(value, '$.item_key') FROM json_each(?)
    )`).bind(payload),
    env.DB.prepare(`INSERT INTO daily_prices (date, item_key, price, unit, source_url, fetched_at)
      SELECT json_extract(value, '$.date'), json_extract(value, '$.item_key'),
        json_extract(value, '$.price'), json_extract(value, '$.unit'),
        json_extract(value, '$.source_url'), json_extract(value, '$.fetched_at')
      FROM json_each(?) WHERE true
      ON CONFLICT(date, item_key) DO UPDATE SET price = excluded.price, unit = excluded.unit,
        source_url = excluded.source_url, fetched_at = excluded.fetched_at
      WHERE excluded.fetched_at >= daily_prices.fetched_at
      RETURNING date, item_key`).bind(payload),
  ]);
  if (!before || !written) throw new Error('Missing D1 batch results');
  const existing = new Set(before.results.map(row => `${row.date}/${row.item_key}`));
  const accepted = written.results.length;
  const updated = written.results.filter(row => existing.has(`${row.date}/${row.item_key}`)).length;
  return json({ accepted, updated, ignored: records.length - accepted });
}

async function latest(db: D1Database): Promise<Response> {
  const { results } = await db.prepare(`WITH ranked AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY item_key ORDER BY date DESC) AS rank FROM daily_prices
  ) SELECT current.date, current.item_key, current.price, current.unit, current.source_url, current.fetched_at,
    previous.date AS previous_date, previous.price AS previous_price
    FROM ranked current LEFT JOIN ranked previous ON current.item_key = previous.item_key AND previous.rank = 2
    WHERE current.rank = 1 ORDER BY current.item_key`).all<PriceRecord & { previous_date: string | null; previous_price: number | null }>();
  return json({ items: results.map(({ previous_price, ...row }) => {
    const previousCents = previous_price === null ? null : Math.round(previous_price * 100);
    const difference = previousCents === null ? null : Math.round(row.price * 100) - previousCents;
    return { ...row, change: difference === null ? null : difference / 100,
      change_percent: difference === null || previousCents === null ? null : Math.round(difference / previousCents * 10_000) / 100 };
  }) });
}

export function historyBounds(range: string, now = new Date()): { from: string; to: string } {
  const to = shanghaiDate(now);
  const start = new Date(`${to}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (Number.parseInt(range, 10) - 1));
  return { from: start.toISOString().slice(0, 10), to };
}
async function history(url: URL, db: D1Database): Promise<Response> {
  const item = url.searchParams.get('item');
  const range = url.searchParams.get('range') ?? '30d';
  if (!isItem(item) || !['7d', '30d', '90d', '365d'].includes(range)) {
    throw new ApiError(400, 'invalid_query', 'item 必须为有效数据项，range 必须为 7d、30d、90d 或 365d');
  }
  const { from, to } = historyBounds(range);
  const { results: points } = await db.prepare(`SELECT date, price, source_url, fetched_at FROM daily_prices
    WHERE item_key = ? AND date >= ? AND date <= ? ORDER BY date ASC`).bind(item, from, to).all();
  return json({ item_key: item, unit: 'CNY/g', range, from, to, points });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const methods: Record<string, string> = { '/healthz': 'GET', '/api/latest': 'GET', '/api/history': 'GET', '/api/ingest': 'POST' };
    try {
      const method = methods[url.pathname];
      if (method && method !== request.method) {
        throw new ApiError(405, 'method_not_allowed', `此接口仅支持 ${method}`);
      }
      if (url.pathname === '/healthz') return json({ status: 'ok', stage: 'api' });
      if (url.pathname === '/api/latest') return await latest(env.DB);
      if (url.pathname === '/api/history') return await history(url, env.DB);
      if (url.pathname === '/api/ingest') return await ingest(request, env);
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) throw new ApiError(404, 'not_found', '接口不存在');
      return await env.ASSETS.fetch(request);
    } catch (error) {
      // Do not log request headers, body, SQL errors or secret-bearing native exceptions.
      const e = error instanceof ApiError ? error : new ApiError(503, 'service_unavailable', '服务暂时不可用，请稍后重试');
      return json({ error: { code: e.code, message: e.message } }, e.status);
    }
  },
};
