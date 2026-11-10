export const ITEM_KEYS = [
  'sge_au9999', 'xau_cny_g', 'china_gold_base', 'china_gold_jewelry',
  'lukfook_jewelry', 'chow_sang_sang_jewelry', 'chow_tai_fook_jewelry',
  'lao_feng_xiang_jewelry', 'lao_miao_jewelry', 'chow_tai_seng_jewelry', 'caibai_jewelry',
] as const;
export type ItemKey = typeof ITEM_KEYS[number];
export interface PriceRecord {
  date: string;
  item_key: ItemKey;
  price: number;
  unit: 'CNY/g';
  source_url: string;
  fetched_at: string;
}
export type ErrorCode = 'timeout' | 'network' | 'http' | 'encoding' | 'structure' | 'price' | 'date' | 'stale' | 'currency' | 'challenge' | 'config' | 'upload';
export class IngestError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  constructor(code: ErrorCode, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}
export interface Failure { source: string; item_key: ItemKey; code: ErrorCode; message: string; fetched_at: string }
export interface Result { records: PriceRecord[]; failures: Failure[]; notes: string[] }
export const emptyResult = (): Result => ({ records: [], failures: [], notes: [] });
export function failure(error: unknown, source: string, item_key: ItemKey, now: Date): Failure {
  // Never forward native fetch errors or source response bodies: these may contain credentials.
  const e = error instanceof IngestError ? error : new IngestError('structure', '响应结构无法识别');
  return { source, item_key, code: e.code, message: e.message, fetched_at: now.toISOString() };
}
export function attempt(result: Result, source: string, key: ItemKey, now: Date, parse: () => PriceRecord): void {
  try { result.records.push(parse()); }
  catch (error) { result.failures.push(failure(error, source, key, now)); }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IngestError('structure', '缺少 JSON 对象');
  return value as Record<string, unknown>;
}
export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new IngestError('structure', '缺少 JSON 数组');
  return value;
}
export function json(text: string): unknown {
  try { return JSON.parse(text) as unknown; }
  catch { throw new IngestError('structure', 'JSON 格式异常'); }
}
export function positive(value: unknown): number {
  const s = typeof value === 'number' || typeof value === 'string' ? String(value).trim() : '';
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(s)) throw new IngestError('price', '价格为空或不是完整数值');
  const n = Number(s.replaceAll(',', ''));
  if (!Number.isFinite(n) || n <= 0) throw new IngestError('price', '价格必须为正有限数');
  return n;
}
export function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new IngestError('date', '报价日期无效');
  }
  return value;
}
export function shanghaiDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function record(key: ItemKey, price: unknown, quotedDate: unknown, url: string, now: Date): PriceRecord {
  const rounded = Math.round((positive(price) + Number.EPSILON) * 100) / 100;
  if (rounded <= 0 || !Number.isFinite(rounded)) throw new IngestError('price', '价格舍入后无效');
  if (new URL(url).protocol !== 'https:') throw new IngestError('structure', '展示页必须为 HTTPS');
  return { date: date(quotedDate), item_key: key, price: rounded, unit: 'CNY/g', source_url: url, fetched_at: now.toISOString() };
}
