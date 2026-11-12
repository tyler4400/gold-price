import { init, use, type EChartsCoreOption } from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import { items, priceText, type AllHistory } from "./market";

use([LineChart, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);
const timestamp = (date: string) => Date.parse(`${date}T00:00:00+08:00`);
const axisDate = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
});
const fullDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Muted jewel tones complement gold; symbols and dash patterns distinguish overlapping lines.
const palettes = {
  light: [
    "#876322", "#386b86", "#9b522d", "#707228", "#80567e", "#28746b",
    "#a4495a", "#555d9b", "#756149", "#397c3f", "#9b5b13",
  ],
  dark: [
    "#e3c37d", "#80b9d7", "#e5a074", "#c6c87e", "#c7a2ce", "#7cc5b4",
    "#e59caa", "#a6b0ec", "#c8b39a", "#a2d397", "#edbc70",
  ],
};
const symbols = ["circle", "rect", "triangle", "diamond", "roundRect", "pin"];
const lineTypes = ["solid", "dashed", "dotted"] as const;
export type LegendSelection = Record<string, boolean>;

export function chartLayout(width: number) {
  const columns = Math.max(1, Math.floor((width - 8) / 128));
  const rows = Math.ceil(items.length / columns);
  const legendData: string[] = [];
  items.forEach((item, index) => {
    if (index > 0 && index % columns === 0) legendData.push("\n");
    legendData.push(item.name);
  });
  const top = 20 + rows * 32;
  return { height: top + 280, top, legendData };
}

export function historyChartOption(
  history: AllHistory,
  dark: boolean,
  width: number,
  selected: LegendSelection = {},
): EChartsCoreOption {
  const layout = chartLayout(width);
  const muted = dark ? "#b6ac99" : "#6b604e";
  const border = dark ? "#443a28" : "#d8ccb5";
  const colors = palettes[dark ? "dark" : "light"];
  return {
    animation: false,
    grid: { left: 12, right: 18, top: layout.top, bottom: 12, containLabel: true },
    textStyle: { fontFamily: "system-ui, sans-serif" },
    legend: {
      type: "plain",
      top: 8,
      left: "center",
      padding: 0,
      itemWidth: 12,
      itemHeight: 10,
      itemGap: 10,
      textStyle: { color: muted, fontSize: 11, width: 100, lineHeight: 22 },
      inactiveColor: dark ? "#615a4c" : "#b6ad9c",
      selected,
      data: layout.legendData,
      formatter: (name: string) =>
        name === items[0].name ? "上金所 Au99.99" : name,
    },
    tooltip: {
      trigger: "axis",
      renderMode: "richText",
      confine: true,
      backgroundColor: dark ? "#171610" : "#fffdf8",
      borderColor: border,
      textStyle: { color: dark ? "#f1ece2" : "#28241c", fontSize: 11 },
      axisPointer: { lineStyle: { color: colors[0], type: "dashed" } },
      valueFormatter: (value: unknown) => `${priceText(Number(value))} 元/克`,
    },
    xAxis: {
      type: "time",
      min: timestamp(history.from),
      max: timestamp(history.to),
      axisLine: { lineStyle: { color: border } },
      axisTick: { show: false },
      axisLabel: {
        color: muted,
        hideOverlap: true,
        formatter: (value: number) => axisDate.format(value),
      },
      splitLine: { show: false },
      splitNumber: width < 480 ? 3 : 5,
      axisPointer: {
        label: {
          backgroundColor: dark ? "#4a3b23" : "#69502b",
          color: dark ? "#e7cfa0" : "#f7ebd1",
          formatter: (params: { value: unknown }) =>
            fullDate.format(Number(params.value)),
        },
      },
    },
    yAxis: {
      type: "value",
      scale: true,
      axisLabel: { color: muted },
      splitNumber: 4,
      splitLine: { lineStyle: { color: border, type: "dashed" } },
    },
    series: items.map((item, index) => {
      const points = history.series.find(
        (series) => series.item_key === item.key,
      )?.points ?? [];
      return {
        id: item.key,
        name: item.name,
        type: "line",
        smooth: false,
        showSymbol: true,
        symbol: symbols[index % symbols.length],
        symbolSize: points.length > 90 ? 4 : 7,
        itemStyle: { color: colors[index] },
        lineStyle: {
          color: colors[index], width: 2,
          type: lineTypes[index % lineTypes.length],
        },
        emphasis: { focus: "series" },
        data: points.map((point) => [timestamp(point.date), point.price]),
      };
    }),
  };
}

export function drawChart(
  element: HTMLDivElement,
  history: AllHistory,
  dark: boolean,
  selected: LegendSelection,
) {
  element.style.height = `${chartLayout(element.clientWidth).height}px`;
  const chart = init(element, undefined, { renderer: "svg" });
  try {
    chart.setOption(
      historyChartOption(history, dark, element.clientWidth, selected),
    );
    chart.on("legendselectchanged", (event: unknown) => {
      Object.assign(selected, (event as { selected: LegendSelection }).selected);
    });
  } catch (error) {
    chart.dispose();
    throw error;
  }
  return {
    resize() {
      const layout = chartLayout(element.clientWidth);
      element.style.height = `${layout.height}px`;
      chart.resize();
      chart.setOption({
        grid: { top: layout.top }, legend: { data: layout.legendData },
      });
    },
    dispose: () => chart.dispose(),
  };
}
