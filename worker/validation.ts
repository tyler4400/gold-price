import { ITEM_KEYS, shanghaiDate } from '../ingest/core.ts';
import type { ItemKey, PriceRecord } from '../ingest/core.ts';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export function isItem(value: unknown): value is ItemKey {
  return typeof value === 'string' && ITEM_KEYS.some(key => key === value);
}

const brandSource = 'https://www.huangjinjiage.cn/pinpaijinjia.html';
const sources: Record<ItemKey, string> = {
  sge_au9999: 'https://finance.sina.com.cn/futures/quotes/AU9999.shtml',
  xau_cny_g: 'https://finance.sina.com.cn/futures/quotes/XAU.shtml',
  china_gold_base: 'https://www.chnau99999.com/page/goldPrice',
  china_gold_jewelry: 'https://www.chnau99999.com/page/goldPrice',
  lukfook_jewelry: 'https://www.lukfook.com/sc/page/goldprice',
  chow_sang_sang_jewelry: 'https://cn.chowsangsang.com/gold-info',
  chow_tai_fook_jewelry: brandSource,
  lao_feng_xiang_jewelry: brandSource,
  lao_miao_jewelry: brandSource,
  chow_tai_seng_jewelry: brandSource,
  caibai_jewelry: brandSource,
};
const fields = ['date', 'item_key', 'price', 'unit', 'source_url', 'fetched_at'];
const maxBytes = 64 * 1024;

function invalid(): never {
  throw new ApiError(400, 'invalid_records', 'records 必须包含 1–100 条有效且不重复的六字段金价记录');
}
function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function isDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function validateRecords(body: unknown, now = new Date()): PriceRecord[] {
  if (!isObject(body) || Object.keys(body).length !== 1 || !Array.isArray(body.records) ||
      body.records.length < 1 || body.records.length > 100) invalid();
  const seen = new Set<string>();
  return body.records.map((value: unknown) => {
    if (!isObject(value) || Object.keys(value).length !== fields.length || !fields.every(key => key in value)) invalid();
    const { date, item_key, price, unit, source_url, fetched_at } = value;
    if (!isItem(item_key) || unit !== 'CNY/g' || typeof price !== 'number' || !Number.isFinite(price) || price <= 0 ||
        !isDate(date) || date < '2000-01-01' ||
        typeof source_url !== 'string' || source_url !== sources[item_key] ||
        typeof fetched_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(fetched_at)) invalid();
    const timestamp = new Date(fetched_at);
    if (!Number.isFinite(timestamp.getTime()) || !isDate(fetched_at.slice(0, 10)) ||
        timestamp.getTime() > now.getTime() + 5 * 60_000 || timestamp.toISOString().slice(0, 19) !== fetched_at.slice(0, 19) ||
        date > shanghaiDate(timestamp)) invalid();
    const cents = Math.round((price + Number.EPSILON) * 100);
    if (!Number.isSafeInteger(cents) || cents <= 0) invalid();
    const key = `${date}/${item_key}`;
    if (seen.has(key)) invalid();
    seen.add(key);
    return { date, item_key, price: cents / 100, unit, source_url, fetched_at: timestamp.toISOString() };
  });
}

export async function readJson(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw new ApiError(415, 'unsupported_media_type', '仅接受 application/json');
  }
  const tooLarge = () => new ApiError(413, 'payload_too_large', '请求体不能超过 64 KiB');
  if (Number(request.headers.get('content-length')) > maxBytes) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'invalid_json', '请求体必须为有效 JSON');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new ApiError(400, 'invalid_json', '请求体必须为有效 JSON'); }
}
