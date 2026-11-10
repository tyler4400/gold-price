import { init, use, type EChartsCoreOption } from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import { priceText, type History } from "./market";

use([LineChart, GridComponent, TooltipComponent, SVGRenderer]);
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

export function drawChart(
  element: HTMLDivElement,
  history: History,
  dark: boolean,
) {
  const chart = init(element, undefined, { renderer: "svg" });
  const muted = dark ? "#aab4bf" : "#57606a";
  const border = dark ? "#30363d" : "#e1e4e8";
  const gold = dark ? "#d4ac58" : "#a97816";
  const option: EChartsCoreOption = {
    animation: false,
    grid: { left: 12, right: 18, top: 24, bottom: 12, containLabel: true },
    textStyle: { fontFamily: "system-ui, sans-serif" },
    tooltip: {
      trigger: "axis",
      renderMode: "richText",
      confine: true,
      backgroundColor: dark ? "#161b22" : "#ffffff",
      borderColor: border,
      textStyle: { color: dark ? "#e6edf3" : "#1a1a1a" },
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
      splitNumber: 5,
      axisPointer: {
        label: {
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
    series: [
      {
        name: "元/克",
        type: "line",
        smooth: false,
        showSymbol: true,
        symbolSize: history.points.length > 90 ? 3 : 6,
        itemStyle: { color: gold },
        lineStyle: { color: gold, width: 2 },
        data: history.points.map((point) => [
          timestamp(point.date),
          point.price,
        ]),
      },
    ],
  };
  try {
    chart.setOption(option);
  } catch (error) {
    chart.dispose();
    throw error;
  }
  return chart;
}
