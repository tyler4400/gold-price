import { useEffect, useRef, useState } from "react";
import { ChartNoAxesCombined } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loading, RequestError } from "@/components/market-status";
import { useMarket } from "@/hooks/use-market";
import { useTheme } from "@/hooks/use-theme";
import {
  items,
  parseHistory,
  priceText,
  ranges,
  type History,
  type ItemKey,
  type Range,
} from "@/lib/market";

function Plot({ history }: { history: History }) {
  const container = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    setError(false);
    setLoading(true);
    void import("@/lib/chart")
      .then(({ drawChart }) => {
        if (disposed || !container.current) return;
        const chart = drawChart(container.current, history);
        const observer = new ResizeObserver(() => chart.resize());
        observer.observe(container.current);
        cleanup = () => {
          observer.disconnect();
          chart.dispose();
        };
        setLoading(false);
      })
      .catch(() => {
        if (!disposed) {
          setLoading(false);
          setError(true);
        }
      });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [history, resolvedTheme, attempt]);
  return (
    <>
      {loading && <Loading>正在绘制走势图…</Loading>}
      {error && (
        <RequestError
          message="图表加载失败，可重试或查看下方数据明细。"
          retry={() => setAttempt((n) => n + 1)}
        />
      )}
      <div
        className="history-plot"
        ref={container}
        role="img"
        aria-label={`历史金价折线图，共 ${history.points.length} 个有效数据点；详细日期和价格见下方数据明细。`}
      />
    </>
  );
}

export function HistoryChart() {
  const [item, setItem] = useState<ItemKey>("sge_au9999");
  const [range, setRange] = useState<Range>("30d");
  const result = useMarket(
    `/api/history?item=${item}&range=${range}`,
    parseHistory,
  );
  const history = result.data;
  const mismatched =
    history && (history.item_key !== item || history.range !== range);
  return (
    <Card className="history-card">
      <div className="section-heading">
        <div>
          <h2>历史走势</h2>
          <p>每日记录，留意金价的长期变化</p>
        </div>
        <label className="history-select-label">
          <span className="sr-only">选择历史报价品种</span>
          <select
            value={item}
            onChange={(event) => setItem(event.target.value as ItemKey)}
          >
            {items.map((value) => (
              <option key={value.key} value={value.key}>
                {value.name}
                {value.key.endsWith("_jewelry") ? "·足金饰品" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="chart-toolbar">
        <span className="text-xs text-muted-foreground">单位：元/克</span>
        <div className="range-controls" role="group" aria-label="历史时间范围">
          {(Object.entries(ranges) as [Range, string][]).map(
            ([value, label]) => (
              <Button
                key={value}
                variant="ghost"
                aria-pressed={range === value}
                onClick={() => setRange(value)}
              >
                {label}
              </Button>
            ),
          )}
        </div>
      </div>
      <div className="chart-content" aria-busy={result.loading}>
        {result.loading && <Loading>正在加载历史报价…</Loading>}
        {(result.error || mismatched) && (
          <RequestError
            message={result.error ?? "历史响应与所选品种或区间不符，请重试。"}
            retry={result.retry}
          />
        )}
        {!result.loading && !mismatched && history && (
          <>
            <p className="history-summary">
              查询区间：{history.from} — {history.to} · 北京时间
            </p>
            {history.points.length ? (
              <>
                <Plot history={history} />
                <p className="history-summary">
                  本区间共 {history.points.length} 个有效数据点 ·
                  本区间最早数据日期：{history.points[0]?.date}
                  {history.points.length === 1
                    ? " · 目前仅有一个数据点，尚不足以形成走势。"
                    : ""}
                </p>
                <details className="history-details">
                  <summary>查看数据明细</summary>
                  <div className="history-data-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">数据日期</th>
                          <th scope="col">价格（元/克）</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.points.map((point) => (
                          <tr key={point.date}>
                            <td>{point.date}</td>
                            <td>{priceText(point.price)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            ) : (
              <div className="empty-history">
                <ChartNoAxesCombined
                  aria-hidden="true"
                  className="size-7 text-muted-foreground"
                />
                <p>所选区间尚无已采集数据</p>
                <p>可以切换更长区间查看；不会补造历史报价。</p>
              </div>
            )}
          </>
        )}
      </div>
      <p className="chart-note">
        只绘制已采集日的报价，缺失日期不补点、不补零；连线仅帮助观察变化，不代表连续实测行情。
      </p>
    </Card>
  );
}
