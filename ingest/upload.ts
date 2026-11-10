import { IngestError } from './core.ts';
import type { PriceRecord } from './core.ts';
import type { RequestText } from './http.ts';
export interface UploadConfig { url: string; token: string }
export function uploadConfig(env: NodeJS.ProcessEnv): UploadConfig {
  const token = env.INGEST_TOKEN?.trim();
  if (!token || /[\r\n]/.test(token) || !env.WORKER_BASE_URL) throw new IngestError('config', '上报需要配置 INGEST_TOKEN 和 WORKER_BASE_URL');
  try {
    const url = new URL(env.WORKER_BASE_URL);
    const localHttp = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
    if ((!localHttp && url.protocol !== 'https:') || url.username || url.password || url.href.includes('?') || url.href.includes('#') || url.pathname !== '/') throw new Error();
    return { url: new URL('/api/ingest', url).href, token };
  } catch { throw new IngestError('config', 'WORKER_BASE_URL 必须是无凭据、路径、查询参数的 HTTPS origin（本地 localhost/127.0.0.1 可用 HTTP）'); }
}
export interface UploadSummary { accepted: number; updated: number; ignored: number }
export async function upload(records: PriceRecord[], config: UploadConfig, request: RequestText): Promise<UploadSummary> {
  const response = await request(config.url, {
    method: 'POST', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: records.map(({ date, item_key, price, unit, source_url, fetched_at }) => ({ date, item_key, price, unit, source_url, fetched_at })) }),
  });
  // A 200 HTML error page is not successful persistence; validate the phase-3 contract.
  let data: unknown;
  try { data = JSON.parse(response) as unknown; } catch { throw new IngestError('upload', '上报响应不是 JSON'); }
  if (!data || typeof data !== 'object' || !('accepted' in data) || !('updated' in data) || !('ignored' in data)) throw new IngestError('upload', '上报响应缺少计数');
  const { accepted, updated, ignored } = data;
  if (![accepted, updated, ignored].every(n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0) ||
      (accepted as number) + (ignored as number) !== records.length || (updated as number) > (accepted as number)) {
    throw new IngestError('upload', '上报响应计数异常');
  }
  return { accepted: accepted as number, updated: updated as number, ignored: ignored as number };
}
