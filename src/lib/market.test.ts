import { afterEach, describe, expect, it, vi } from "vitest";
import {
  comparison,
  fetchJson,
  items,
  parseHistory,
  parseLatest,
  todayInShanghai,
  type LatestItem,
} from "./market";
import { ITEM_KEYS } from "../../ingest/core";

// Synthetic values used only in tests; no preview prices are bundled in the app.
const quote: LatestItem = {
  item_key: "sge_au9999",
  unit: "CNY/g",
  date: "2026-11-10",
  price: 100,
  source_url: "https://finance.sina.com.cn/futures/quotes/AU9999.shtml",
  fetched_at: "2026-11-10T00:00:00Z",
  previous_date: null,
  change: null,
  change_percent: null,
};
const history = {
  item_key: quote.item_key,
  unit: quote.unit,
  range: "30d",
  from: "2026-10-12",
  to: quote.date,
  points: [quote],
};
afterEach(() => vi.unstubAllGlobals());
describe("market contract and display", () => {
  it("keeps all API items and separates the two China Gold categories", () => {
    expect(items.map((item) => item.key)).toEqual(ITEM_KEYS);
    expect(items.slice(3)).toHaveLength(8);
    expect(
      items.slice(3).some((item) => String(item.key) === "china_gold_base"),
    ).toBe(false);
  });
  it("preserves empty and partial latest responses without inventing brands", () => {
    expect(parseLatest({ items: [] }).items).toEqual([]);
    expect(parseLatest({ items: [quote] }).items).toEqual([quote]);
    expect(comparison(quote).text).toBe("暂无对比");
  });
  it("uses API changes and previous date, including a rounded zero percentage", () => {
    expect(
      comparison({
        ...quote,
        previous_date: "2026-11-06",
        change: 0.01,
        change_percent: 0,
      }),
    ).toEqual({
      text: "+0.01 (0.00%)",
      tone: "up",
      basis: "较 2026-11-06（上一有效数据日），涨跌额单位为元/克",
    });
    expect(
      comparison({
        ...quote,
        previous_date: "2026-11-06",
        change: -2,
        change_percent: -1.96,
      }).text,
    ).toBe("−2.00 (−1.96%)");
    expect(
      comparison({
        ...quote,
        previous_date: "2026-11-06",
        change: -2,
        change_percent: -1.96,
      }).tone,
    ).toBe("down");
    expect(
      comparison({
        ...quote,
        previous_date: "2026-11-06",
        change: 0,
        change_percent: 0,
      }).text,
    ).toBe("持平 0.00 (0.00%)");
  });
  it("uses Beijing calendar date across UTC midnight", () => {
    expect(todayInShanghai(new Date("2026-11-09T16:01:00Z"))).toBe(
      "2026-11-10",
    );
  });
  it("keeps one point and missing days exactly as returned", () => {
    expect(parseHistory(history).points).toHaveLength(1);
    const sparse = [{ ...quote, date: "2026-11-06" }, quote];
    expect(parseHistory({ ...history, points: sparse }).points).toEqual(sparse);
    expect(parseHistory({ ...history, points: [] }).points).toEqual([]);
  });
  it("rejects malformed prices, duplicate dates and unsorted history", () => {
    expect(() => parseLatest({ items: [{ ...quote, price: 0 }] })).toThrow();
    expect(() =>
      parseLatest({ items: [{ ...quote, change: undefined }] }),
    ).toThrow();
    expect(() =>
      parseHistory({ ...history, points: [quote, quote] }),
    ).toThrow();
    expect(() =>
      parseHistory({
        ...history,
        points: [quote, { ...quote, date: "2026-11-06" }],
      }),
    ).toThrow();
  });
  it("distinguishes HTTP, non-JSON and invalid payload failures from empty data", async () => {
    const request = () =>
      fetchJson("/api/latest", parseLatest, new AbortController().signal);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 503 })),
    );
    await expect(request()).rejects.toThrow("HTTP 503");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<!doctype html>")),
    );
    await expect(request()).rejects.toThrow("JSON");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ error: "not an empty market" })),
    );
    await expect(request()).rejects.toThrow("格式异常");
  });
});
