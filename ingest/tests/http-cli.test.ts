import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createRequester } from '../http.ts';
import { IngestError, emptyResult } from '../core.ts';
import { parseChinaGold } from '../adapters/china-gold.ts';
import { main } from '../cli.ts';
import { upload, uploadConfig } from '../upload.ts';
const now = new Date('2026-11-10T09:05:00Z');
const result = () => parseChinaGold(readFileSync(new URL('../fixtures/china.json', import.meta.url), 'utf-8'), now);
globalThis.fetch = async () => { throw new Error('Offline tests forbid network access'); };
const isCode = (code: string) => (e: unknown) => e instanceof IngestError && e.code === code;

test('HTTP 网络/429/5xx 有限重试，401/403/411 不重试', async () => {
  for (const status of [429, 500, 503, 401, 403, 411]) {
    let calls = 0;
    const sleeps: number[] = [];
    const request = createRequester({ fetch: async () => { calls++; return new Response('', { status, headers: { 'Retry-After': '1' } }); }, sleep: async ms => { sleeps.push(ms); } });
    await assert.rejects(request('https://example.com'), isCode('http'));
    assert.equal(calls, status === 429 || status >= 500 ? 3 : 1);
    assert.deepEqual(sleeps, status === 429 || status >= 500 ? [1000, 2000] : []);
  }
  let calls = 0;
  const request = createRequester({ fetch: async () => { if (++calls < 3) throw new Error('network'); return new Response('ok'); }, sleep: async () => {} });
  assert.equal(await request('https://example.com'), 'ok');
  assert.equal(calls, 3);
});
test('网络故障最多尝试三次，指数退避，成功即停止', async () => {
  for (const succeeds of [true, false]) {
    let calls = 0;
    const sleeps: number[] = [];
    const request = createRequester({ fetch: async () => {
      if (++calls < 3 || !succeeds) throw new Error('connection reset');
      return new Response('ok');
    }, sleep: async ms => { sleeps.push(ms); } });
    if (succeeds) assert.equal(await request('https://example.com'), 'ok');
    else await assert.rejects(request('https://example.com'), isCode('network'));
    assert.equal(calls, 3);
    assert.deepEqual(sleeps, [1000, 2000]);
  }
});
test('请求与 body 超时均有限重试，每次使用新 signal，恢复后立即返回', async () => {
  for (const bodyTimeout of [false, true]) for (const succeeds of [true, false]) {
    const signals: AbortSignal[] = [];
    const sleeps: number[] = [];
    const request = createRequester({ timeoutMs: 10, fetch: async (_url, init) => {
      assert.ok(init?.signal);
      assert.equal(init.signal.aborted, false);
      signals.push(init.signal);
      if (succeeds && signals.length === 2) return new Response('recovered');
      const wait = new Promise<never>((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('timeout'))));
      if (!bodyTimeout) return wait;
      return { ok: true, arrayBuffer: () => wait } as unknown as Response;
    }, sleep: async ms => { sleeps.push(ms); } });
    if (succeeds) assert.equal(await request('https://example.com'), 'recovered');
    else await assert.rejects(request('https://example.com'), isCode('timeout'));
    assert.equal(signals.length, succeeds ? 2 : 3);
    assert.equal(new Set(signals).size, signals.length);
    assert.deepEqual(sleeps, succeeds ? [1000] : [1000, 2000]);
  }
});
test('单请求可放宽到 30 秒且不改变后续默认超时', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal | null | undefined;
  const request = createRequester({ retries: 0, fetch: async (_url, init) => {
    signal = init?.signal;
    return new Promise<never>((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('timeout'))));
  } });
  for (const timeoutMs of [30_000, undefined]) {
    const rejected = assert.rejects(request('https://example.com', { timeoutMs }), isCode('timeout'));
    t.mock.timers.tick((timeoutMs ?? 15_000) - 1);
    assert.equal(signal?.aborted, false);
    t.mock.timers.tick(1);
    await rejected;
  }
});
test('超时覆盖请求和读取响应；错误消息不泄漏原始错误', async () => {
  for (const bodyTimeout of [false, true]) {
    const request = createRequester({ retries: 0, timeoutMs: 10, fetch: async (_url, init) => {
      const wait = new Promise<never>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('INGEST_TOKEN'))));
      if (!bodyTimeout) return wait;
      return { ok: true, arrayBuffer: () => wait } as unknown as Response;
    } });
    await assert.rejects(request('https://example.com'), isCode('timeout'));
  }
  const request = createRequester({ retries: 0, fetch: async () => { throw new Error('INGEST_TOKEN'); } });
  await assert.rejects(request('https://example.com'), e => isCode('network')(e) && !(e as Error).message.includes('INGEST_TOKEN'));
});
test('原始字节按 GB18030/GBK 解码，坏编码不重试，所有请求禁止重定向', async () => {
  let calls = 0;
  const request = createRequester({ fetch: async (_url, init) => {
    calls++;
    assert.equal(init?.redirect, 'error');
    assert.match(new Headers(init?.headers).get('User-Agent') ?? '', /GoldPrice/);
    return new Response(readFileSync(new URL('../fixtures/sge.gb18030', import.meta.url)));
  } });
  assert.match(await request('https://example.com', { encoding: 'gb18030' }), /沪金99/);
  assert.equal(calls, 1);
  const bad = createRequester({ fetch: async () => { calls++; return new Response(new Uint8Array([0x81])); } });
  await assert.rejects(bad('https://example.com', { encoding: 'gbk' }), isCode('encoding'));
  assert.equal(calls, 2);
});
test('默认和显式 dry-run 从不发送 ingest POST，即使环境有配置', async () => {
  for (const args of [[], ['--dry-run'], ['--', '--dry-run'], ['--network'], ['--network', '--dry-run']]) {
    let requests = 0;
    const output: string[] = [];
    const code = await main(args, { INGEST_TOKEN: 'INGEST_TOKEN', WORKER_BASE_URL: 'https://YOUR_WORKER_HOST' }, {
      collect: async () => result(), request: async () => { requests++; throw new Error(); }, print: text => output.push(text),
    });
    assert.equal(code, 0);
    assert.equal(requests, 0);
    assert.equal(JSON.parse(output[0] ?? '{}').summary.uploaded, false);
    assert.ok(!output.join('').includes('INGEST_TOKEN'));
  }
});
test('上报必须配置受限 origin 和密钥，缺配置在抓取前明确失败', async () => {
  const output: string[] = [];
  assert.equal(await main(['--upload'], {}, { collect: async () => { throw new Error('should not collect'); }, print: s => output.push(s) }), 1);
  assert.equal(JSON.parse(output[0] ?? '{}').error.code, 'config');
  for (const url of ['http://YOUR_WORKER_HOST', 'https://YOUR_WORKER_HOST?token=INGEST_TOKEN', 'https://INGEST_TOKEN@YOUR_WORKER_HOST', 'https://YOUR_WORKER_HOST/path', 'https://YOUR_WORKER_HOST/#INGEST_TOKEN']) {
    assert.throws(() => uploadConfig({ WORKER_BASE_URL: url, INGEST_TOKEN: 'INGEST_TOKEN' }), isCode('config'));
  }
  assert.equal(await main(['--upload', '--dry-run'], {}, { print: () => {} }), 1);
  assert.equal(await main(['--unknown'], {}, { print: () => {} }), 1);
});
test('上报仅发送六字段 body，凭据仅在 header，核对响应；失败退出非零', async () => {
  const config = uploadConfig({ WORKER_BASE_URL: 'https://YOUR_WORKER_HOST', INGEST_TOKEN: 'INGEST_TOKEN' });
  await upload(result().records, config, async (url, options) => {
    assert.ok(!url.includes('INGEST_TOKEN'));
    assert.ok(url.endsWith('/api/ingest'));
    assert.equal(options?.method, 'POST');
    assert.equal(options?.headers?.Authorization, 'Bearer INGEST_TOKEN');
    assert.deepEqual(JSON.parse(options?.body ?? '{}'), { records: result().records });
    return '{"accepted":2,"updated":1,"ignored":0}';
  });
  for (const response of ['<html>error</html>', '{}', '{"accepted":1,"updated":0,"ignored":0}', '{"accepted":2,"updated":3,"ignored":0}']) {
    await assert.rejects(upload(result().records, config, async () => response), isCode('upload'));
  }
  const env = { WORKER_BASE_URL: 'https://YOUR_WORKER_HOST', INGEST_TOKEN: 'INGEST_TOKEN' };
  const output: string[] = [];
  assert.equal(await main(['--upload'], env, { collect: async () => result(), request: async () => { throw new IngestError('http', 'HTTP 401'); }, print: s => output.push(s) }), 1);
  assert.ok(!output.join('').includes('INGEST_TOKEN'));
  assert.equal(JSON.parse(output[0] ?? '{}').records.length, 2);
  assert.equal(JSON.parse(output[0] ?? '{}').upload_error.code, 'http');
  assert.equal(await main(['--upload'], env, { collect: async () => result(), request: async () => '{"accepted":2,"updated":0,"ignored":0}', print: () => {} }), 0);
});
test('CLI 两关键项都失败即使上报其它项成功仍非零，无记录不 POST', async () => {
  const partial = result();
  partial.records = partial.records.filter(r => r.item_key === 'china_gold_jewelry');
  assert.equal(await main([], {}, { collect: async () => partial, print: () => {} }), 1);
  const env = { WORKER_BASE_URL: 'https://YOUR_WORKER_HOST', INGEST_TOKEN: 'INGEST_TOKEN' };
  assert.equal(await main(['--upload'], env, { collect: async () => partial, request: async () => '{"accepted":1,"updated":0,"ignored":0}', print: () => {} }), 1);
  let calls = 0;
  assert.equal(await main(['--upload'], env, { collect: async () => emptyResult(), request: async () => { calls++; return '{}'; }, print: () => {} }), 1);
  assert.equal(calls, 0);
});


test('本地 HTTP 仅允许 localhost/127.0.0.1 origin，拒绝其它 HTTP 或附加 URL 信息', () => {
  for (const origin of ['http://127.0.0.1:8787', 'http://localhost:8787', 'http://127.0.0.1', 'http://localhost', 'https://example.com:8443']) {
    assert.equal(uploadConfig({ WORKER_BASE_URL: origin, INGEST_TOKEN: 'INGEST_TOKEN' }).url, `${origin}/api/ingest`);
  }
  for (const origin of ['http://192.168.1.1', 'http://0.0.0.0', 'http://[::1]', 'http://localhost.evil.example', 'http://127.0.0.2', 'http://localhost/path', 'https://example.com/?', 'https://example.com/#', 'http://localhost?token=INGEST_TOKEN', 'http://localhost/#fragment', 'http://INGEST_TOKEN@localhost', 'http://localhost:password@evil.example']) {
    assert.throws(() => uploadConfig({ WORKER_BASE_URL: origin, INGEST_TOKEN: 'INGEST_TOKEN' }), isCode('config'));
  }
});
test('CLI --upload 可上传到本地 Worker，并打印成功计数而不泄漏 token', async () => {
  const output: string[] = [];
  const env = { WORKER_BASE_URL: 'http://127.0.0.1:8787', INGEST_TOKEN: 'INGEST_TOKEN' };
  const code = await main(['--', '--upload'], env, {
    collect: async () => result(), print: s => output.push(s),
    request: async (url, options) => {
      assert.equal(url, 'http://127.0.0.1:8787/api/ingest');
      assert.equal(options?.headers?.Authorization, 'Bearer INGEST_TOKEN');
      return '{"accepted":2,"updated":1,"ignored":0}';
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(output[0] ?? '{}').summary, { succeeded: 2, failed: 0, critical_ok: true, uploaded: true, accepted: 2, updated: 1, ignored: 0, exit_code: 0 });
  assert.ok(!output.join('').includes('INGEST_TOKEN'));
});
