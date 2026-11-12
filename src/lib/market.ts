import type { ItemKey, PriceRecord } from "../../ingest/core";

export const items = [
  { key: "sge_au9999", name: "上金所基础金价 Au99.99" },
  { key: "xau_cny_g", name: "国际现货金参考价" },
  { key: "china_gold_base", name: "中国黄金·基础金价" },
  { key: "china_gold_jewelry", name: "中国黄金" },
  { key: "lukfook_jewelry", name: "六福" },
  { key: "chow_sang_sang_jewelry", name: "周生生" },
  { key: "chow_tai_fook_jewelry", name: "周大福" },
  { key: "lao_feng_xiang_jewelry", name: "老凤祥" },
  { key: "lao_miao_jewelry", name: "老庙" },
  { key: "chow_tai_seng_jewelry", name: "周大生" },
  { key: "caibai_jewelry", name: "菜百首饰" },
] as const satisfies readonly { key: ItemKey; name: string }[];

export const ranges = {
  "7d": "近一周",
  "30d": "近一个月",
  "90d": "近三个月",
  "365d": "近一年",
} as const;
export type Range = keyof typeof ranges;
export type { ItemKey };
export interface LatestItem extends PriceRecord {
  previous_date: string | null;
  change: number | null;
  change_percent: number | null;
}
export interface Latest {
  items: LatestItem[];
}
export interface History {
  item_key: ItemKey;
  unit: "CNY/g";
  range: Range;
  from: string;
  to: string;
  points: Pick<PriceRecord, "date" | "price" | "source_url" | "fetched_at">[];
}
export interface AllHistory extends Omit<History, "item_key" | "points"> {
  series: Pick<History, "item_key" | "points">[];
}

export const priceText = (value: number) =>
  value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
export function isConsecutiveDay(date: string, previousDate: string | null) {
  return (
    validDate(date) &&
    validDate(previousDate) &&
    Date.parse(date) - Date.parse(previousDate) === 86_400_000
  );
}
export function comparisonDate(item: LatestItem): string | null {
  return item.previous_date && !isConsecutiveDay(item.date, item.previous_date)
    ? item.previous_date
    : null;
}
export function comparison(item: LatestItem) {
  if (item.previous_date === null || item.change === null) {
    return {
      text: "暂无对比",
      tone: "neutral",
      basis: "尚无上一有效日期的报价",
    };
  }
  const date = comparisonDate(item);
  const amount = Math.abs(item.change).toLocaleString("zh-CN", {
    maximumFractionDigits: 2,
  });
  return {
    text: `${item.change > 0 ? "▲" : item.change < 0 ? "▼−" : ""}${amount}`,
    tone: item.change > 0 ? "up" : item.change < 0 ? "down" : "neutral",
    basis: `较上次统计${date ? `（${date}，上一有效数据日）` : ""}，涨跌额单位为元/克`,
  };
}
export function todayInShanghai(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function fetchedTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    dateStyle: "short",
    timeStyle: "short",
    hour12: false,
  }).format(new Date(value));
}

// Reject malformed responses (including a static host returning SPA HTML) as errors, never as an empty market.
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("行情响应格式异常，请稍后重试。");
  return value as Record<string, unknown>;
}
function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
function validPoint(value: unknown) {
  const row = object(value);
  if (
    !validDate(row.date) ||
    typeof row.price !== "number" ||
    !Number.isFinite(row.price) ||
    row.price <= 0 ||
    typeof row.source_url !== "string" ||
    !row.source_url.startsWith("https://") ||
    typeof row.fetched_at !== "string" ||
    !Number.isFinite(Date.parse(row.fetched_at))
  )
    throw new Error("报价数据格式异常，请稍后重试。");
  return row;
}
export function parseLatest(value: unknown): Latest {
  const data = object(value);
  if (!Array.isArray(data.items))
    throw new Error("行情响应格式异常，请稍后重试。");
  const keys = new Set();
  for (const value of data.items) {
    const row = validPoint(value);
    if (
      !items.some((item) => item.key === row.item_key) ||
      keys.has(row.item_key) ||
      row.unit !== "CNY/g" ||
      !(row.previous_date === null || validDate(row.previous_date)) ||
      ![row.change, row.change_percent].every(
        (n) => n === null || (typeof n === "number" && Number.isFinite(n)),
      )
    )
      throw new Error("行情响应格式异常，请稍后重试。");
    keys.add(row.item_key);
  }
  return data as unknown as Latest;
}
export function parseHistory(value: unknown): History {
  const data = object(value);
  if (
    !items.some((item) => item.key === data.item_key) ||
    data.unit !== "CNY/g" ||
    typeof data.range !== "string" ||
    !Object.hasOwn(ranges, data.range) ||
    !validDate(data.from) ||
    !validDate(data.to) ||
    data.from > data.to ||
    !Array.isArray(data.points)
  )
    throw new Error("历史响应格式异常，请稍后重试。");
  let previous = "";
  for (const point of data.points) {
    const row = validPoint(point);
    const date = row.date as string;
    if (date <= previous || date < data.from || date > data.to)
      throw new Error("历史日期顺序或范围异常，请稍后重试。");
    previous = date;
  }
  return data as unknown as History;
}

export function parseAllHistory(value: unknown): AllHistory {
  const data = object(value);
  if (!Array.isArray(data.series) || data.series.length !== items.length)
    throw new Error("历史响应格式异常，请稍后重试。");
  const keys = new Set();
  for (const value of data.series) {
    const series = object(value);
    const history = parseHistory({
      unit: data.unit,
      range: data.range,
      from: data.from,
      to: data.to,
      item_key: series.item_key,
      points: series.points,
    });
    if (keys.has(history.item_key))
      throw new Error("历史品种重复，请稍后重试。");
    keys.add(history.item_key);
  }
  return data as unknown as AllHistory;
}

export async function fetchJson<T>(
  url: string,
  parse: (data: unknown) => T,
  signal: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(`请求失败（HTTP ${response.status}），请稍后重试。`);
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error("接口未返回有效 JSON，请检查行情服务后重试。");
  }
  return parse(value);
}
