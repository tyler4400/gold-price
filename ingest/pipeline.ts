import { emptyResult, failure } from './core.ts';
import type { ItemKey, Result } from './core.ts';
import { createRequester } from './http.ts';
import type { RequestText } from './http.ts';
import { fetchSina } from './adapters/sina.ts';
import { fetchChinaGold } from './adapters/china-gold.ts';
import { fetchLukfook } from './adapters/lukfook.ts';
import { fetchChowSangSang } from './adapters/chow-sang-sang.ts';
import { BRANDS, fetchBrands } from './adapters/brands.ts';
const adapters: { source: string; keys: readonly ItemKey[]; run: (request: RequestText, now: () => Date) => Promise<Result> }[] = [
  { source: 'sina', keys: ['sge_au9999', 'xau_cny_g'], run: fetchSina },
  { source: 'china-gold', keys: ['china_gold_base', 'china_gold_jewelry'], run: fetchChinaGold },
  { source: 'lukfook', keys: ['lukfook_jewelry'], run: fetchLukfook },
  { source: 'chow-sang-sang', keys: ['chow_sang_sang_jewelry'], run: fetchChowSangSang },
  { source: 'brands', keys: BRANDS.map(b => b.key), run: fetchBrands },
];
export async function collect(request: RequestText = createRequester(), now: () => Date = () => new Date()): Promise<Result> {
  const settled = await Promise.allSettled(adapters.map(adapter => adapter.run(request, now)));
  const result = emptyResult();
  for (const [index, entry] of settled.entries()) {
    const adapter = adapters[index];
    if (!adapter) continue;
    if (entry.status === 'fulfilled') {
      result.records.push(...entry.value.records);
      result.failures.push(...entry.value.failures);
      result.notes.push(...entry.value.notes);
    } else for (const key of adapter.keys) result.failures.push(failure(entry.reason, adapter.source, key, now()));
  }
  return result;
}
export function collectionExitCode(result: Result): 0 | 1 {
  return result.records.length > 0 && result.records.some(r => r.item_key === 'sge_au9999' || r.item_key === 'china_gold_base') ? 0 : 1;
}
