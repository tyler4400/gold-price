import { emptyResult, IngestError, json, object, record, shanghaiDate } from '../core.ts';
import type { Result } from '../core.ts';
import type { RequestText } from '../http.ts';
export const LUKFOOK_FETCH_URL = 'https://www.lukfook.com/api/goldprice';
export const LUKFOOK_SOURCE_URL = 'https://www.lukfook.com/sc/page/goldprice';
export function parseLukfook(text: string, now: Date): Result {
  const root = object(json(text));
  if (root.status !== 1) throw new IngestError('structure', '六福响应状态异常');
  const prices = object(object(object(root.data).cn).data);
  const selected = Object.hasOwn(prices, '足金999(克)') ? prices['足金999(克)'] : prices['足金(克)'];
  const result = emptyResult();
  result.records.push(record('lukfook_jewelry', object(selected)['賣出(RMB)'], shanghaiDate(now), LUKFOOK_SOURCE_URL, now));
  // The API does not expose the display page's scDateFormat.
  result.notes.push('六福 API 未提供报价日期，使用抓取时刻的 Asia/Shanghai 日期。');
  return result;
}
export async function fetchLukfook(request: RequestText, now: () => Date): Promise<Result> {
  return parseLukfook(await request(LUKFOOK_FETCH_URL), now());
}
