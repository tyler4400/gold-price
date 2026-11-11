import { pathToFileURL } from 'node:url';
import { IngestError } from './core.ts';
import type { Result } from './core.ts';
import { createRequester } from './http.ts';
import type { RequestText } from './http.ts';
import { collect, collectionExitCode } from './pipeline.ts';
import { upload, uploadConfig } from './upload.ts';
import type { UploadSummary } from './upload.ts';
export async function main(args = process.argv.slice(2), env = process.env, dependencies: {
  request?: RequestText; collect?: () => Promise<Result>; print?: (text: string) => void;
} = {}): Promise<number> {
  const print = dependencies.print ?? console.log;
  try {
    const flags = args.filter(arg => arg !== '--');
    if (flags.some(arg => !['--network', '--dry-run', '--upload'].includes(arg)) || (flags.includes('--dry-run') && flags.includes('--upload'))) {
      throw new IngestError('config', '用法：pnpm ingest [--network] [--dry-run | --upload]；默认联网 dry-run');
    }
    const dryRun = !flags.includes('--upload');
    const config = dryRun ? undefined : uploadConfig(env);
    const request = dependencies.request ?? createRequester();
    const result = await (dependencies.collect ?? (() => collect(request)))();
    let code = collectionExitCode(result);
    let uploaded = false;
    let uploadSummary: UploadSummary | undefined;
    let uploadError: { code: string; message: string } | undefined;
    if (config && result.records.length) {
      try {
        uploadSummary = await upload(result.records, config, request);
        uploaded = true;
      } catch (error) {
        const e = error instanceof IngestError ? error : new IngestError('upload', '上报失败');
        uploadError = { code: e.code, message: e.message };
      }
    }
    if (!dryRun && !uploaded) code = 1;
    print(JSON.stringify({ dry_run: dryRun, ...result, ...(uploadError ? { upload_error: uploadError } : {}), summary: {
      succeeded: result.records.length, failed: result.failures.length,
      critical_ok: collectionExitCode(result) === 0, uploaded, ...uploadSummary, exit_code: code,
    } }, null, 2));
    return code;
  } catch (error) {
    const e = error instanceof IngestError ? error : new IngestError('structure', '抓取管线发生异常');
    print(JSON.stringify({ error: { code: e.code, message: e.message }, exit_code: 1 }));
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
