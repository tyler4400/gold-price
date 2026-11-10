import { attempt, emptyResult, IngestError, json, object, record, shanghaiDate } from '../core.ts';
import type { Result } from '../core.ts';
import type { RequestText } from '../http.ts';
export const CHINA_FETCH_URL = 'https://www.chnau99999.com/page/board';
export const CHINA_SOURCE_URL = 'https://www.chnau99999.com/page/goldPrice';
export function parseChinaGold(text: string, now: Date): Result {
  const root = object(json(text));
  if (root.code !== 200) throw new IngestError('structure', '中国黄金响应状态异常');
  const data = object(root.data);
  const result = emptyResult();
  // The observed board response has no quotation date; do not use HTTP Date as a quotation date.
  result.notes.push('中国黄金未提供报价日期，使用抓取时刻的 Asia/Shanghai 日期。');
  for (const [key, field] of [['china_gold_base', 'cur'], ['china_gold_jewelry', 'accessories']] as const) {
    attempt(result, 'china-gold', key, now, () => record(key, data[field], shanghaiDate(now), CHINA_SOURCE_URL, now));
  }
  return result;
}
export async function fetchChinaGold(request: RequestText, now: () => Date): Promise<Result> {
  const text = await request(CHINA_FETCH_URL, { method: 'POST', headers: { 'Content-Length': '0' }, body: '' });
  return parseChinaGold(text, now());
}
