import { RefreshCw } from "lucide-react";
import { GithubLink } from "@/components/github-link";
import { ThemeToggleButton } from "@/components/theme/theme-toggle-button";
import { Quotes, BrandTable } from "@/components/quotes";
import { HistoryChart } from "@/components/history-chart";
import { SourcesFooter } from "@/components/sources-footer";
import { Loading, RequestError } from "@/components/market-status";
import { Button } from "@/components/ui/button";
import { useMarket } from "@/hooks/use-market";
import { parseLatest } from "@/lib/market";

export function App() {
  const latest = useMarket("/api/latest", parseLatest);
  const quotes = latest.data?.items ?? [];
  return (
    <div className="page-layout">
      <a className="skip-link" href="#main-content">
        跳至行情内容
      </a>
      <aside className="side-slot" data-slot="left-aside" aria-hidden="true" />
      <div className="content-shell">
        <header className="site-header">
          <a href="/" aria-label="金价首页" className="site-logo">
            <span className="size-2 rounded-full bg-gold" aria-hidden="true" />
            金价 <span>gold-price</span>
          </a>
          <nav aria-label="外观与项目" className="flex items-center gap-1">
            <ThemeToggleButton />
            <GithubLink />
          </nav>
        </header>
        <main id="main-content">
          <div className="page-intro">
            <div>
              <p className="eyebrow">公开金价 · 每日记录</p>
              <h1>让金价变化，一目了然。</h1>
              <p className="intro-description">
                基础金价、国际参考与品牌饰品报价，在这里一起看。
              </p>
            </div>
            <Button
              variant="outline"
              onClick={latest.retry}
              disabled={latest.loading}
            >
              <RefreshCw aria-hidden="true" />
              刷新行情
            </Button>
          </div>
          {latest.loading && <Loading>正在加载最新行情…</Loading>}
          {latest.error && (
            <RequestError
              message={`${latest.error}${latest.data ? " 以下保留上次成功读取的报价，请留意日期。" : ""}`}
              retry={latest.retry}
            />
          )}
          {!latest.loading && !latest.error && quotes.length === 0 && (
            <div className="empty-market" role="status">
              <strong>行情库暂为空</strong>
              <p>还没有已入库的报价。后续采集入库后，可刷新查看。</p>
            </div>
          )}
          <Quotes
            quotes={quotes}
            loading={latest.loading}
            failed={Boolean(latest.error)}
          />
          <HistoryChart />
          <BrandTable
            quotes={quotes}
            loading={latest.loading}
            failed={Boolean(latest.error)}
          />
        </main>
        <SourcesFooter />
      </div>
      <aside className="side-slot" data-slot="right-aside" aria-hidden="true" />
    </div>
  );
}
