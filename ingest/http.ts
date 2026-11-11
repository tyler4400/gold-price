import { setTimeout as delay } from 'node:timers/promises';
import { IngestError } from './core.ts';

export type Encoding = 'utf-8' | 'gb18030' | 'gbk';
export interface RequestOptions { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string; encoding?: Encoding; timeoutMs?: number }
export type RequestText = (url: string, options?: RequestOptions) => Promise<string>;
export function decode(bytes: ArrayBuffer | Uint8Array, encoding: Encoding): string {
  try { return new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { throw new IngestError('encoding', '响应无法按指定编码解码'); }
}
export function createRequester(options: {
  fetch?: typeof fetch; timeoutMs?: number; retries?: number; sleep?: (ms: number) => Promise<unknown>;
} = {}): RequestText {
  const fetcher = options.fetch ?? globalThis.fetch;
  return async (url, request = {}) => {
    const retries = options.retries ?? 2; // Three total attempts, including the initial request.
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? options.timeoutMs ?? 15_000);
      let retryAfter = 0;
      let failed: IngestError;
      try {
        const response = await fetcher(url, {
          method: request.method ?? 'GET',
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GoldPrice/0.1; daily price research)', ...request.headers },
          ...(request.body !== undefined ? { body: request.body } : {}),
          signal: controller.signal,
          // In particular, never forward Authorization to a redirected destination.
          redirect: 'error',
        });
        if (!response.ok) {
          const header = response.headers.get('retry-after');
          if (header) retryAfter = Math.min(5_000, Math.max(0, /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now())) || 0;
          await response.body?.cancel();
          throw new IngestError('http', `HTTP ${response.status}`, response.status === 429 || response.status >= 500);
        }
        return decode(await response.arrayBuffer(), request.encoding ?? 'utf-8');
      } catch (error) {
        failed = controller.signal.aborted ? new IngestError('timeout', '请求或响应读取超时', true)
          : error instanceof IngestError ? error : new IngestError('network', '网络请求失败', true);
      } finally { clearTimeout(timer); }
      if (!failed.retryable || attempt >= retries) throw failed;
      await (options.sleep ?? delay)(Math.max(retryAfter, 1_000 * 2 ** attempt));
    }
  };
}
