import { load } from 'cheerio';
import { array, emptyResult, IngestError, json, object, record, shanghaiDate } from '../core.ts';
import type { Result } from '../core.ts';
import type { RequestText } from '../http.ts';
export const CSS_SOURCE_URL = 'https://cn.chowsangsang.com/gold-info';
export function parseChowSangSang(html: string, now: Date): Result {
  // Normal pages can load Akamai scripts too; the vendor name alone is not a challenge.
  if (/Access Denied|sec-cpt|_sec\/cp_challenge|verify you are human/i.test(html)) throw new IngestError('challenge', '周生生返回反爬挑战页面');
  const $ = load(html);
  const page = $('gold-info-page');
  if (page.length !== 1) throw new IngestError('structure', '缺少唯一金价组件');
  const raw = page.attr(':gold-prices');
  if (!raw) throw new IngestError('structure', '缺少内嵌 prices JSON');
  // Parse only the component's JSON attribute. Never execute page scripts.
  const products = array(json(raw)).map(object).filter(p => p.label === '足金饰品 (每克）');
  if (products.length !== 1) throw new IngestError('structure', '足金饰品条目缺失或重复');
  const sells = array(products[0]?.items).map(object).filter(p => p.name === '卖出');
  if (sells.length !== 1) throw new IngestError('structure', '卖出条目缺失或重复');
  const result = emptyResult();
  const time = page.attr('time');
  if (time && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(time)) throw new IngestError('date', '周生生报价时间格式异常');
  if (!time) result.notes.push('周生生未提供报价日期，使用抓取时刻的 Asia/Shanghai 日期。');
  result.records.push(record('chow_sang_sang_jewelry', sells[0]?.price, time?.slice(0, 10) ?? shanghaiDate(now), CSS_SOURCE_URL, now));
  return result;
}
export async function fetchChowSangSang(request: RequestText, now: () => Date): Promise<Result> {
  // This source can respond slowly; each attempt includes both headers and body.
  return parseChowSangSang(await request(CSS_SOURCE_URL, { timeoutMs: 30_000 }), now());
}
