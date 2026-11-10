import { attempt, date, emptyResult, failure, IngestError, positive, record } from '../core.ts';
import type { Result } from '../core.ts';
import type { RequestText } from '../http.ts';
export const SINA_URLS = {
  sge: 'https://hq.sinajs.cn/list=gds_AU9999', xau: 'https://hq.sinajs.cn/list=hf_XAU',
  fx: 'https://hq.sinajs.cn/list=fx_susdcny',
};
export const SGE_SOURCE_URL = 'https://finance.sina.com.cn/futures/quotes/AU9999.shtml';
export const XAU_SOURCE_URL = 'https://finance.sina.com.cn/futures/quotes/XAU.shtml';
export const FX_SOURCE_URL = 'https://finance.sina.com.cn/money/forex/hq/USDCNY.shtml';
export const TROY_OUNCE_GRAMS = 31.1034768;
export const MAX_AGE_MS = 36 * 60 * 60 * 1000;
export const MAX_SKEW_MS = 6 * 60 * 60 * 1000;
// Observed 2026-11-10: futures [0] latest, [6] Beijing clock, [12] date, [13] name.
// fx_susdcny: [0] clock, [1] bid CNY per USD, [2] ask, [9] name, [17] date.
// Select the bid consistently; no inverted quote or hard-coded exchange rate fallback.
export function sinaCsv(text: string, symbol: string, length: number): string[] {
  const match = /^\s*var\s+hq_str_([A-Za-z0-9_]+)\s*=\s*"([^"\r\n]*)";\s*$/.exec(text);
  if (!match || match[1] !== symbol) throw new IngestError('structure', '新浪赋值字符串或行情代码不符');
  const fields = (match[2] ?? '').split(',');
  if (fields.length !== length) throw new IngestError('structure', '新浪 CSV 字段数变化或空行情');
  return fields;
}
function quoteTime(day: unknown, clock: unknown): number {
  const d = date(day);
  if (typeof clock !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(clock)) throw new IngestError('date', '新浪报价时间无效');
  return Date.parse(`${d}T${clock}+08:00`);
}
export function parseSge(text: string, now: Date) {
  const f = sinaCsv(text, 'gds_AU9999', 14);
  if (f[13] !== '沪金99') throw new IngestError('structure', 'Au99.99 行情名称变化');
  quoteTime(f[12], f[6]);
  return record('sge_au9999', f[0], f[12], SGE_SOURCE_URL, now);
}
export function parseInternational(xau: string, fx: string, now: Date) {
  const gold = sinaCsv(xau, 'hf_XAU', 14);
  const rate = sinaCsv(fx, 'fx_susdcny', 18);
  if (gold[13] !== '伦敦金（现货黄金）') throw new IngestError('structure', '国际现货金名称不符');
  const bid = positive(rate[1]);
  const ask = positive(rate[2]);
  if (rate[9] !== '在岸人民币' || bid < 1 || bid > 20 || ask < bid || ask > 20) {
    throw new IngestError('currency', 'USD/CNY 方向、名称或买卖报价不符');
  }
  const goldTime = quoteTime(gold[12], gold[6]);
  const fxTime = quoteTime(rate[17], rate[0]);
  for (const time of [goldTime, fxTime]) {
    if (now.getTime() - time > MAX_AGE_MS || time - now.getTime() > 5 * 60 * 1000) throw new IngestError('stale', '国际金价或汇率过期/超前');
  }
  if (gold[12] !== rate[17] || Math.abs(goldTime - fxTime) > MAX_SKEW_MS) throw new IngestError('stale', '国际金价与汇率日期或时间不兼容');
  return record('xau_cny_g', positive(gold[0]) * bid / TROY_OUNCE_GRAMS, gold[12], XAU_SOURCE_URL, now);
}
export async function fetchSina(request: RequestText, now: () => Date): Promise<Result> {
  const options = { headers: { Referer: 'https://finance.sina.com.cn' }, encoding: 'gb18030' as const };
  const [sge, xau, fx] = await Promise.allSettled([
    request(SINA_URLS.sge, options), request(SINA_URLS.xau, options), request(SINA_URLS.fx, options),
  ]);
  const result = emptyResult();
  const fetchedAt = now();
  if (sge.status === 'fulfilled') attempt(result, 'sina', 'sge_au9999', fetchedAt, () => parseSge(sge.value, fetchedAt));
  else result.failures.push(failure(sge.reason, 'sina', 'sge_au9999', fetchedAt));
  if (xau.status === 'fulfilled' && fx.status === 'fulfilled') {
    attempt(result, 'sina', 'xau_cny_g', fetchedAt, () => parseInternational(xau.value, fx.value, fetchedAt));
  } else {
    for (const input of [xau, fx]) if (input.status === 'rejected') result.failures.push(failure(input.reason, 'sina', 'xau_cny_g', fetchedAt));
  }
  result.notes.push(`国际参考价汇率来源：${SINA_URLS.fx}（展示页 ${FX_SOURCE_URL}）；采用 USD/CNY 买价，人民币/美元。`);
  return result;
}
