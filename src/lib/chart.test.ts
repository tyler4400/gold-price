import { describe, expect, it } from "vitest";
import { init } from "echarts/core";
import { chartLayout, historyChartOption } from "./chart";
import { items, type AllHistory } from "./market";

const history: AllHistory = {
  unit: "CNY/g", range: "7d", from: "2026-11-06", to: "2026-11-12",
  series: items.map(({ key }, index) => ({
    item_key: key,
    points: index === 2 ? [] : ["2026-11-06", "2026-11-12"].map((date, day) => ({
      date, price: 800 + index * 20 + day * 5,
      source_url: "https://example.com/price", fetched_at: `${date}T00:00:00Z`,
    })),
  })),
};

describe("all-item history chart", () => {
  it.each([false, true])("renders all series in theme dark=%s without filling missing dates", dark => {
    const chart = init(null, undefined, { renderer: "svg", ssr: true, width: 920, height: chartLayout(920).height });
    try {
      chart.setOption(historyChartOption(history, dark, 920));
      const option = chart.getOption();
      const series = option.series as { id: string; data: [number, number][]; itemStyle: { color: string } }[];
      expect(series.map(series => series.id)).toEqual(items.map(item => item.key));
      expect(new Set(series.map(series => series.itemStyle.color)).size).toBe(items.length);
      for (const [index, seriesItem] of series.entries()) {
        expect(seriesItem.data).toEqual(history.series[index]!.points.map(point => [Date.parse(`${point.date}T00:00:00+08:00`), point.price]));
      }
      expect(chart.renderToSVGString()).toContain("上金所 Au99.99");
      const legend = () => (chart.getOption().legend as { selected: Record<string, boolean> }[])[0]!.selected;
      expect(items.every(item => legend()[item.name] !== false)).toBe(true);
      chart.dispatchAction({ type: "legendToggleSelect", name: items[0].name });
      expect(legend()[items[0].name]).toBe(false);
      expect(legend()[items[1].name]).not.toBe(false);
      chart.dispatchAction({ type: "legendToggleSelect", name: items[0].name });
      expect(legend()[items[0].name]).toBe(true);
    } finally {
      chart.dispose();
    }
  });
  it("restores selection after chart recreation and reserves more space for narrow legends", () => {
    const mobile = chartLayout(266);
    const desktop = chartLayout(920);
    expect(mobile.top).toBeGreaterThan(desktop.top);
    expect(mobile.height - mobile.top).toBe(desktop.height - desktop.top);
    expect(mobile.legendData.filter(name => name !== "\n")).toEqual(items.map(item => item.name));
    expect(mobile.legendData.filter(name => name === "\n")).toHaveLength(5);
    const chart = init(null, undefined, { renderer: "svg", ssr: true, width: 266, height: mobile.height });
    try {
      chart.setOption(historyChartOption(history, false, 266, { [items[0].name]: false }));
      expect((chart.getOption().legend as { selected: Record<string, boolean> }[])[0]!.selected[items[0].name]).toBe(false);
      expect(chart.renderToSVGString()).toContain("菜百首饰");
    } finally {
      chart.dispose();
    }
  });
});
