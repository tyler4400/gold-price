import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { IngestError, ITEM_KEYS, positive, record, shanghaiDate } from '../core.ts';
import { decode } from '../http.ts';
import { parseSge, parseInternational, fetchSina, SINA_URLS, TROY_OUNCE_GRAMS } from '../adapters/sina.ts';
import { parseChinaGold } from '../adapters/china-gold.ts';
import { parseLukfook, LUKFOOK_SOURCE_URL } from '../adapters/lukfook.ts';
import { parseChowSangSang } from '../adapters/chow-sang-sang.ts';
import { parseBrands } from '../adapters/brands.ts';
import { collect, collectionExitCode } from '../pipeline.ts';
import type { RequestText } from '../http.ts';
const now = new Date('2026-11-10T09:05:00.000Z');
const bytes = (path: string) => readFileSync(new URL(`../fixtures/${path}`, import.meta.url));
const fixture = (path: string, encoding: 'utf-8' | 'gb18030' | 'gbk' = 'utf-8') => decode(bytes(path), encoding);
const sge = fixture('sge.gb18030', 'gb18030');
const xau = fixture('xau.gb18030', 'gb18030');
const fx = fixture('fx.gb18030', 'gb18030');
const china = fixture('china.json');
const lukfook = fixture('lukfook.json');
const css = fixture('chow-sang-sang.html');
const brands = fixture('brands.gbk.html', 'gbk');
const throwsCode = (fn: () => unknown, code: string) => assert.throws(fn, (e: unknown) => e instanceof IngestError && e.code === code);

// No test can silently reach the network. All responses below come from saved fixtures.
globalThis.fetch = async () => { throw new Error('Offline tests forbid network access'); };

test('新浪：GB18030 名称和固定价格/日期字段，不取时间或其它数值', () => {
  assert.equal(parseSge(sge, now).price, 883);
  assert.equal(parseSge(sge, now).date, '2026-11-10');
  assert.equal(parseSge(sge, new Date('2026-11-12T00:00:00Z')).date, '2026-11-10');
  throwsCode(() => parseSge(sge.replace('883.00,', ','), now), 'price');
  throwsCode(() => parseSge(sge.replace('gds_AU9999', 'hf_XAU'), now), 'structure');
  throwsCode(() => parseSge(sge.replace(',沪金99', ',extra,沪金99'), now), 'structure');
});
test('国际折算：美元/盎司 × USD/CNY 买价 ÷ 31.1034768，最后舍入', () => {
  const r = parseInternational(xau, fx, now);
  assert.equal(r.price, Math.round(4096.80 * 6.6678 / TROY_OUNCE_GRAMS * 100) / 100);
  assert.equal(r.date, '2026-11-10');
  assert.equal(r.unit, 'CNY/g');
});
test('国际折算：拒绝缺汇率、反方向、旧行情、跨日及时间差过大', () => {
  throwsCode(() => parseInternational(xau, fixture('negative/fx-missing.txt'), now), 'structure');
  throwsCode(() => parseInternational(xau, fixture('negative/fx-reversed.gb18030', 'gb18030'), now), 'currency');
  throwsCode(() => parseInternational(xau, fixture('negative/fx-stale.gb18030', 'gb18030'), now), 'stale');
  throwsCode(() => parseInternational(xau.replace('2026-11-10', '2026-11-06'), fx, now), 'stale');
  throwsCode(() => parseInternational(xau, fx.replace('2026-11-10', '2026-11-09'), now), 'stale');
  throwsCode(() => parseInternational(xau, fx.replace('17:03:02', '09:00:00'), now), 'stale');
  throwsCode(() => parseInternational(xau, fx.replace('17:03:02', '18:00:00'), now), 'stale');
  throwsCode(() => parseInternational(xau, fx.replace('在岸人民币', '美元'), now), 'currency');
  throwsCode(() => parseInternational(xau.replace('4096.80,', '0,'), fx, now), 'price');
});
test('新浪三个请求独立，固定 Referer 和编码；缺 FX 不影响 Au99.99', async () => {
  let count = 0;
  const result = await fetchSina(async (url, options) => {
    count++;
    assert.equal(options?.encoding, 'gb18030');
    assert.equal(options?.headers?.Referer, 'https://finance.sina.com.cn');
    if (url === SINA_URLS.fx) throw new IngestError('timeout', '请求超时');
    return url === SINA_URLS.sge ? sge : xau;
  }, () => now);
  assert.equal(count, 3);
  assert.deepEqual(result.records.map(r => r.item_key), ['sge_au9999']);
  assert.equal(result.failures[0]?.code, 'timeout');
  assert.match(result.notes.join(''), /fx_susdcny/);
});
test('中国黄金拆分基础/饰品，空基础仅影响一条；上海跨 UTC 日期', () => {
  const result = parseChinaGold(china, new Date('2026-11-10T17:00:00Z'));
  assert.deepEqual(result.records.map(r => [r.item_key, r.price, r.date]), [
    ['china_gold_base', 877.4, '2026-11-11'], ['china_gold_jewelry', 1236, '2026-11-11'],
  ]);
  assert.match(result.notes.join(''), /Asia\/Shanghai/);
  const broken = parseChinaGold(fixture('negative/china-empty-base.json'), now);
  assert.deepEqual(broken.records.map(r => r.item_key), ['china_gold_jewelry']);
  assert.equal(broken.failures[0]?.code, 'price');
  throwsCode(() => parseChinaGold(fixture('negative/structure.json'), now), 'structure');
});
test('六福只读内地卖出价，999 优先、普通足金备选，不回退到换购/香港', () => {
  assert.equal(parseLukfook(lukfook, now).records[0]?.price, 1237);
  assert.equal(parseLukfook(lukfook, now).records[0]?.source_url, LUKFOOK_SOURCE_URL);
  const root = JSON.parse(lukfook);
  root.data.cn.data['足金(克)']['賣出(RMB)'] = '1,200';
  assert.equal(parseLukfook(JSON.stringify(root), now).records[0]?.price, 1237);
  root.data.cn.data['足金999(克)'] = null;
  throwsCode(() => parseLukfook(JSON.stringify(root), now), 'structure');
  delete root.data.cn.data['足金999(克)'];
  assert.equal(parseLukfook(JSON.stringify(root), now).records[0]?.price, 1200);
  delete root.data.cn;
  throwsCode(() => parseLukfook(JSON.stringify(root), now), 'structure');
  throwsCode(() => parseLukfook(fixture('negative/lukfook-empty.json'), now), 'price');
  throwsCode(() => parseLukfook(fixture('negative/structure.json'), now), 'structure');
});
test('周生生从 JSON 取足金饰品卖出，保留明确日期', () => {
  const result = parseChowSangSang(css, new Date('2026-11-11T00:00:00Z'));
  assert.equal(result.records[0]?.price, 1243);
  assert.equal(result.records[0]?.date, '2026-11-10');
  assert.equal(result.notes.length, 0);
  assert.equal(parseChowSangSang('<script src="/akamai.js"></script>' + css, now).records[0]?.price, 1243);
});
test('周生生挑战页、无卖出、空价及脚本表达式均失败，不执行脚本', () => {
  throwsCode(() => parseChowSangSang(fixture('negative/challenge.html'), now), 'challenge');
  throwsCode(() => parseChowSangSang(fixture('negative/css-empty.html'), now), 'price');
  throwsCode(() => parseChowSangSang(fixture('negative/css-no-sell.html'), now), 'structure');
  throwsCode(() => parseChowSangSang(fixture('negative/css-script.html'), now), 'structure');
  throwsCode(() => parseChowSangSang('<script>const prices = [];</script>', now), 'structure');
});
test('品牌 GBK 表格五项，选饰品而非回收/金条/999 纯度', () => {
  const result = parseBrands(brands, now);
  assert.equal(result.failures.length, 0);
  assert.deepEqual(result.records.map(r => r.price), [1239, 1236, 1233, 1239, 1225]);
  assert.ok(result.records.every(r => r.date === '2026-11-10'));
});
test('品牌按表头定位：日期、纯度先出现仍取正确价；坏行不抹掉好行', () => {
  const result = parseBrands(fixture('negative/brands-columns.html'), now);
  assert.deepEqual(result.records.map(r => [r.item_key, r.price]), [['chow_tai_fook_jewelry', 1239], ['lao_miao_jewelry', 1233]]);
  assert.deepEqual(result.failures.map(f => [f.item_key, f.code]), [
    ['lao_feng_xiang_jewelry', 'price'], ['chow_tai_seng_jewelry', 'structure'], ['caibai_jewelry', 'date'],
  ]);
});
test('拒绝品牌模糊匹配、邻近数字、重复行、未知表头及缺单位', () => {
  const near = parseBrands(brands.replaceAll('周大福</td>', '周大福珠宝</td>'), now);
  assert.equal(near.records.length, 4);
  assert.equal(near.failures[0]?.item_key, 'chow_tai_fook_jewelry');
  assert.equal(parseBrands('<p>周大福 2026-11-10 足金999 1239元/克</p>', now).records.length, 0);
  assert.equal(parseBrands(brands + brands, now).records.length, 0);
  assert.equal(parseBrands(brands.replaceAll('元/克', ''), now).records.length, 0);
  assert.equal(parseBrands(brands.replaceAll('<th>品牌</th>', '<th>未知</th>'), now).records.length, 0);
});
test('数值、日期和编码校验', () => {
  for (const value of ['', ' ', 0, -1, NaN, Infinity, null, true, '12abc', '1,23', '0x100', '2026-11-10']) throwsCode(() => positive(value), 'price');
  assert.equal(positive('1,237.20'), 1237.2);
  throwsCode(() => record('sge_au9999', 0.001, '2026-11-10', 'https://example.com', now), 'price');
  throwsCode(() => record('sge_au9999', 883, '2026-02-30', 'https://example.com', now), 'date');
  throwsCode(() => decode(new Uint8Array([0x81]), 'gbk'), 'encoding');
  throwsCode(() => decode(new Uint8Array([0xff]), 'utf-8'), 'encoding');
  assert.equal(shanghaiDate(new Date('2026-11-10T16:00:00Z')), '2026-11-11');
});
const request: RequestText = async (url, options) => {
  if (url.includes('gds_AU9999')) return sge;
  if (url.includes('hf_XAU')) return xau;
  if (url.includes('fx_susdcny')) return fx;
  if (url.includes('/page/board')) {
    assert.equal(options?.method, 'POST');
    assert.equal(options?.body, '');
    assert.equal(options?.headers?.['Content-Length'], '0');
    return china;
  }
  if (url.includes('lukfook')) return lukfook;
  if (url.includes('chowsangsang')) return css;
  assert.match(url, /^https:\/\/www.huangjinjiage.cn\//);
  assert.equal(options?.encoding, 'gbk');
  return brands;
};
test('完整离线管线产生 11 项合法六字段记录，每源一次（新浪三次）', async () => {
  let calls = 0;
  const result = await collect(async (url, options) => { calls++; return request(url, options); }, () => now);
  assert.equal(calls, 7);
  assert.equal(result.records.length, 11);
  assert.equal(result.failures.length, 0);
  assert.equal(collectionExitCode(result), 0);
  assert.deepEqual(new Set(result.records.map(r => r.item_key)), new Set(ITEM_KEYS));
  for (const r of result.records) {
    assert.deepEqual(Object.keys(r).sort(), ['date', 'fetched_at', 'item_key', 'price', 'source_url', 'unit']);
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(r.source_url, /^https:\/\//);
    assert.equal(r.fetched_at, now.toISOString());
    assert.ok(r.price > 0 && Number.isFinite(r.price));
    assert.equal(r.price, Number(r.price.toFixed(2)));
  }
});
test('关键项任一有效 exit 0，两项全坏或无记录 exit 1，异常不会抹去其他源', async () => {
  for (const broken of [['gds_AU9999'], ['/page/board'], ['gds_AU9999', '/page/board']]) {
    const result = await collect(async (url, options) => {
      if (broken.some(part => url.includes(part))) throw new IngestError('http', 'HTTP 503');
      return request(url, options);
    }, () => now);
    assert.equal(collectionExitCode(result), broken.length === 2 ? 1 : 0);
    assert.ok(result.records.some(r => r.item_key === 'caibai_jewelry'));
  }
  const result = await collect(async () => { throw new IngestError('timeout', '超时'); }, () => now);
  assert.equal(result.records.length, 0);
  assert.equal(collectionExitCode(result), 1);
  assert.ok(result.failures.length >= 11);
});
