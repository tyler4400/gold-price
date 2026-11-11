import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { BRANDS_SOURCE_URL, CSS_FALLBACK_BRAND, parseBrands } from '../adapters/brands.ts';
import { CSS_SOURCE_URL, fetchChowSangSang } from '../adapters/chow-sang-sang.ts';
import { IngestError } from '../core.ts';
import { createRequester, decode } from '../http.ts';
import { collect } from '../pipeline.ts';
import { main } from '../cli.ts';

const now = new Date('2026-11-11T09:00:00Z');
const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url));
const official = fixture('chow-sang-sang.html').toString('utf8');
const fallbackBytes = fixture('chow-sang-sang-fallback.gbk.html');
const fallback = decode(fallbackBytes, 'gbk');
const parse = (html: string) => parseBrands(html, now, [CSS_FALLBACK_BRAND]);
globalThis.fetch = async () => { throw new Error('Offline tests forbid network access'); };

test('周生生 GBK 实抓表只选黄金首饰每克价，不选铂金、金条或换购价', () => {
  assert.match(fallback, /周生生黄金价格/);
  for (const label of ['PT950铂金价格', '工艺金条价格', '黄金换购价格', '铂金换购价格']) assert.ok(fallback.includes(label));
  assert.deepEqual(parse(fallback), {
    records: [{ date: '2026-11-11', item_key: 'chow_sang_sang_jewelry', price: 1212,
      unit: 'CNY/g', source_url: BRANDS_SOURCE_URL, fetched_at: now.toISOString() }],
    failures: [], notes: [],
  });
  // The usual five-brand pass must never emit a competing Chow Sang Sang record.
  assert.ok(!parseBrands(fallback, now).records.some(r => r.item_key === 'chow_sang_sang_jewelry'));
});

test('周生生兜底拒绝缺行、重复、近似品牌、错误单位、坏价格和日期', () => {
  for (const html of [
    fallback.replace('<td>黄金价格</td>', '<td>投资金条价格</td>'),
    fallback + fallback,
    fallback.replaceAll('<td>周生生</td>', '<td>周生生珠宝</td>'),
    fallback.replace('1212元/克', '1212元/盎司'),
    fallback.replace('1212元/克', '0元/克'),
    fallback.replace('1212元/克', '元/克'),
    fallback.replaceAll('2026-11-11', '2026-02-30'),
    fallback.replace('<th>价格</th>', '<th>纯度</th>'),
  ]) {
    const result = parse(html);
    assert.equal(result.records.length, 0);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0]?.item_key, 'chow_sang_sang_jewelry');
  }
  assert.equal(parse(fallback.replaceAll('2026-11-11', '2026-11-09')).records[0]?.date, '2026-11-09');
});

test('官网成功即返回官网报价和来源，不请求兜底', async () => {
  const calls: string[] = [];
  const result = await fetchChowSangSang(async (url, options) => {
    calls.push(url);
    assert.equal(url, CSS_SOURCE_URL);
    assert.equal(options?.timeoutMs, 30_000);
    return official;
  }, () => now);
  assert.deepEqual(calls, [CSS_SOURCE_URL]);
  assert.equal(result.records[0]?.price, 1243);
  assert.equal(result.records[0]?.source_url, CSS_SOURCE_URL);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.notes, []);
});

test('官网 HTTP 403/302 后用 GBK 兜底，保留官网失败和兜底说明', async () => {
  for (const status of [403, 302]) {
    const calls: string[] = [];
    const request = createRequester({ fetch: async url => {
      calls.push(String(url));
      if (url === CSS_SOURCE_URL) return new Response(null, { status });
      assert.equal(url, BRANDS_SOURCE_URL);
      return new Response(fallbackBytes);
    } });
    const result = await fetchChowSangSang(request, () => now);
    assert.deepEqual(calls, [CSS_SOURCE_URL, BRANDS_SOURCE_URL]);
    assert.deepEqual(result.records, parse(fallback).records);
    assert.equal(result.failures[0]?.source, 'chow-sang-sang');
    assert.equal(result.failures[0]?.message, `HTTP ${status}`);
    assert.match(result.notes.join(''), /已使用聚合站兜底/);
  }
});

test('官网挑战、结构或价格解析失败也可兜底', async () => {
  for (const name of ['challenge.html', 'css-empty.html', 'css-no-sell.html', 'css-script.html']) {
    const result = await fetchChowSangSang(async url => url === CSS_SOURCE_URL
      ? fixture(`negative/${name}`).toString('utf8') : fallback, () => now);
    assert.deepEqual(result.records, parse(fallback).records);
    assert.equal(result.failures.length, 1);
    assert.match(result.notes.join(''), /已使用聚合站兜底/);
  }
});

test('管线官网优先，即使聚合页含周生生也不会生成重复或覆盖官网记录', async () => {
  const result = await collect(async url => {
    if (url === CSS_SOURCE_URL) return official;
    if (url === BRANDS_SOURCE_URL) return fallback;
    throw new IngestError('network', '网络请求失败');
  }, () => now);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0]?.source_url, CSS_SOURCE_URL);
});

test('官网和兜底都失败时无周生生上报记录，仍上传其它有效项并保留失败说明', async () => {
  for (const failureMode of ['network', 'missing-row']) {
    const result = await collect(async url => {
      if (url.endsWith('/page/board')) return fixture('china.json').toString('utf8');
      if (url === BRANDS_SOURCE_URL && failureMode === 'missing-row') return '<html></html>';
      throw new IngestError('network', '网络请求失败');
    }, () => now);
    assert.ok(result.records.length > 0);
    assert.ok(result.records.every(r => r.item_key !== 'chow_sang_sang_jewelry'));
    assert.deepEqual(result.failures.filter(f => f.item_key === 'chow_sang_sang_jewelry').map(f => f.source), ['chow-sang-sang', 'brands']);
    assert.match(result.notes.join(''), /均失败.*保留已存价格/);
    let uploads = 0;
    const code = await main(['--upload'], { WORKER_BASE_URL: 'https://example.com', INGEST_TOKEN: 'test-only' }, {
      collect: async () => result, print: () => {}, request: async (_url, options) => {
        uploads++;
        assert.deepEqual(JSON.parse(options?.body ?? '{}'), { records: result.records });
        return JSON.stringify({ accepted: result.records.length, updated: 0, ignored: 0 });
      },
    });
    assert.equal(code, 0);
    assert.equal(uploads, 1);
  }
});
