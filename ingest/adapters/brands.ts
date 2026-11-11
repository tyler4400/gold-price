import { load } from 'cheerio';
import { attempt, emptyResult, IngestError, record } from '../core.ts';
import type { ItemKey, Result } from '../core.ts';
import type { RequestText } from '../http.ts';
export const BRANDS_SOURCE_URL = 'https://www.huangjinjiage.cn/pinpaijinjia.html';
// Product labels are per-brand allowlists, based on the saved retail tables.
// 菜百 selects 足金价格, not 足金999价格 or 饰品金条价格.
interface Brand { key: ItemKey; aliases: readonly string[]; product: string }
export const BRANDS: readonly Brand[] = [
  { key: 'chow_tai_fook_jewelry', aliases: ['周大福'], product: '首饰黄金价格' },
  { key: 'lao_feng_xiang_jewelry', aliases: ['老凤祥'], product: '黄金价格' },
  { key: 'lao_miao_jewelry', aliases: ['老庙黄金', '老庙'], product: '黄金价格' },
  { key: 'chow_tai_seng_jewelry', aliases: ['周大生'], product: '黄金价格' },
  { key: 'caibai_jewelry', aliases: ['菜百首饰', '菜百黄金'], product: '足金价格' },
];
// Kept out of BRANDS: the official adapter alone decides whether to use this row.
export const CSS_FALLBACK_BRAND: Brand = {
  key: 'chow_sang_sang_jewelry', aliases: ['周生生'], product: '黄金价格',
};
const clean = (text: string) => text.replace(/\s+/g, '').trim();
export function parseBrands(html: string, now: Date, brands: readonly Brand[] = BRANDS): Result {
  const $ = load(html);
  const result = emptyResult();
  const candidates = new Map<ItemKey, { price: string | undefined; date: string | undefined; valid: boolean }[]>();
  $('table').each((_i, table) => {
    const rows = $(table).find('tr').filter((_j, tr) => $(tr).closest('table')[0] === table);
    const headers = rows.first().children('th,td').toArray().map(cell => clean($(cell).text()));
    const column = (names: string[]) => {
      const indices = headers.flatMap((h, i) => names.includes(h) ? [i] : []);
      return indices.length === 1 ? indices[0] ?? -1 : -1;
    };
    const brandCol = column(['品牌']);
    const productCol = column(['产品']);
    const priceCol = column(['价格', '今日价格']);
    const dateCol = column(['更新时间', '报价时间']);
    // Current source includes 元/克 in the price cell; also accept an explicit unit column.
    const unitCol = column(['单位']);
    if ([brandCol, productCol, priceCol, dateCol].some(i => i < 0)) return;
    rows.slice(1).each((_j, row) => {
      const cells = $(row).children('td').toArray().map(cell => clean($(cell).text()));
      const brand = brands.find(b => b.aliases.includes(cells[brandCol] ?? '') && cells[productCol] === b.product);
      if (!brand) return;
      const priceCell = cells[priceCol] ?? '';
      const match = /^(\d+(?:\.\d+)?)元\/克$/.exec(priceCell);
      const price = unitCol >= 0 ? priceCell : match?.[1];
      const valid = cells.length === headers.length && (unitCol >= 0 ? cells[unitCol] === '元/克' : !!match) &&
        $(row).children('[colspan],[rowspan]').length === 0;
      const list = candidates.get(brand.key) ?? [];
      list.push({ price, date: cells[dateCol], valid });
      candidates.set(brand.key, list);
    });
  });
  for (const brand of brands) attempt(result, 'brands', brand.key, now, () => {
    const matches = candidates.get(brand.key) ?? [];
    if (matches.length !== 1) throw new IngestError('structure', '品牌及饰品产品行缺失或重复');
    const row = matches[0];
    if (!row?.valid) throw new IngestError('structure', '品牌行列数、价格或人民币元/克单位异常');
    return record(brand.key, row.price, row.date, BRANDS_SOURCE_URL, now);
  });
  return result;
}
export async function fetchBrands(request: RequestText, now: () => Date, brands: readonly Brand[] = BRANDS): Promise<Result> {
  return parseBrands(await request(BRANDS_SOURCE_URL, { encoding: 'gbk' }), now(), brands);
}
