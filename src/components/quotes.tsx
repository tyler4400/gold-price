import { Bell, ExternalLink } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  comparison,
  fetchedTime,
  items,
  priceText,
  todayInShanghai,
  type LatestItem,
} from "@/lib/market";

export function SourceLink({
  item,
  children,
}: {
  item: LatestItem;
  children: ReactNode;
}) {
  return (
    <a
      href={item.source_url}
      target="_blank"
      rel="noopener noreferrer"
      className="source-link"
      title="查看报价来源（新标签页）"
    >
      {children}
      <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
    </a>
  );
}
export function Change({ item }: { item?: LatestItem }) {
  if (!item) return <span className="text-muted-foreground">—</span>;
  const value = comparison(item);
  return (
    <span className={`price-change ${value.tone}`} title={value.basis}>
      {value.tone !== "neutral" && (
        <span aria-hidden="true">{value.tone === "up" ? "↑ " : "↓ "}</span>
      )}
      {value.text}
    </span>
  );
}
export function QuoteDate({ item }: { item: LatestItem }) {
  const old = item.date < todayInShanghai();
  return (
    <span className="quote-date">
      <time
        dateTime={item.date}
        title={`抓取于 ${fetchedTime(item.fetched_at)}（北京时间）`}
      >
        {item.date}
      </time>
      {old && <span className="stale-label">非今日数据</span>}
    </span>
  );
}

export function Quotes({
  quotes,
  loading,
  failed,
}: {
  quotes: LatestItem[];
  loading: boolean;
  failed: boolean;
}) {
  const byKey = new Map(quotes.map((item) => [item.item_key, item]));
  const main = byKey.get("sge_au9999");
  const missing = loading
    ? "正在加载报价…"
    : failed
      ? "行情请求失败，请重试"
      : "该项尚无已入库报价";
  const [notice, setNotice] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  function remind() {
    setNotice(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(false), 4000);
  }
  return (
    <section
      className="quotes-grid"
      aria-label="基础金价与国际参考"
      aria-busy={loading}
    >
      <Card className="main-quote">
        <div className="flex items-center gap-2">
          <span className="eyebrow">基础金价</span>
          <span className="gold-mark" aria-hidden="true" />
        </div>
        <h2 className="mt-3 font-semibold">上金所基础金价 Au99.99</h2>
        <div className="main-price">
          {main ? priceText(main.price) : "—"}
          <span>元/克</span>
        </div>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">较昨日</span>
          <Change item={main} />
        </p>
        {main?.previous_date && (
          <p className="mt-1 text-xs text-muted-foreground">
            对比 {main.previous_date} · 上一有效数据日
          </p>
        )}
        <div className="main-quote-bottom">
          <div className="text-xs text-muted-foreground">
            {main ? (
              <>
                <p className="mb-1">数据日期</p>
                <QuoteDate item={main} />
              </>
            ) : (
              <p>{missing}</p>
            )}
          </div>
          <Button onClick={remind}>
            <Bell aria-hidden="true" />
            设到价提醒
          </Button>
        </div>
        <div
          role="status"
          aria-live="polite"
          className={notice ? "notice-toast" : "sr-only"}
        >
          {notice ? "即将上线" : ""}
        </div>
      </Card>
      {(["xau_cny_g", "china_gold_base"] as const).map((key) => {
        const item = byKey.get(key);
        return (
          <Card className="secondary-quote" key={key}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">
                {key === "xau_cny_g" ? "国际现货金" : "中国黄金·基础金价"}
              </h2>
              <span className="quote-badge">
                {key === "xau_cny_g" ? "参考" : "基础报价补充"}
              </span>
            </div>
            <p className="secondary-price">
              {item ? priceText(item.price) : "—"}
              <span>元/克</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {item ? (
                <>
                  <span className="mr-2">数据日期</span>
                  <QuoteDate item={item} />
                </>
              ) : (
                missing
              )}
            </p>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              {key === "xau_cny_g"
                ? "国际金价按汇率折算，受汇率与采样时间影响。"
                : "基础金价单独列示；足金饰品报价见下表。"}
            </p>
          </Card>
        );
      })}
    </section>
  );
}

export function BrandTable({
  quotes,
  loading,
  failed,
}: {
  quotes: LatestItem[];
  loading: boolean;
  failed: boolean;
}) {
  const byKey = new Map(quotes.map((item) => [item.item_key, item]));
  return (
    <Card className="brand-card">
      <div className="section-heading">
        <div>
          <h2>品牌金店金价</h2>
          <p>足金饰品挂牌价 · 品牌名称可查看报价来源</p>
        </div>
        <span className="eyebrow">8 个品牌</span>
      </div>
      <table className="brand-table" aria-busy={loading}>
        <caption className="sr-only">
          品牌足金饰品报价，涨跌额单位为元/克；较昨日指上一有效数据日。
        </caption>
        <thead>
          <tr>
            <th scope="col">品牌</th>
            <th scope="col">
              足金饰品价<span>（元/克）</span>
            </th>
            <th scope="col">较昨日涨跌</th>
            <th scope="col">更新日期</th>
          </tr>
        </thead>
        <tbody>
          {items.slice(3).map(({ key, name }) => {
            const item = byKey.get(key);
            return (
              <tr key={key}>
                <th scope="row">
                  {item ? <SourceLink item={item}>{name}</SourceLink> : name}
                </th>
                <td className="brand-price">
                  {item ? priceText(item.price) : "—"}
                  {!item && (
                    <span className="missing-price">
                      {loading ? "加载中" : failed ? "请求失败" : "暂无数据"}
                    </span>
                  )}
                </td>
                <td>
                  <Change item={item} />
                  {item?.previous_date && (
                    <span className="comparison-date">
                      对比 {item.previous_date}
                    </span>
                  )}
                </td>
                <td>{item ? <QuoteDate item={item} /> : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="table-note">
        “较昨日”对比上一有效数据日，不一定是日历昨天。饰品价可能另计工费，以门店实际报价为准。
      </p>
    </Card>
  );
}
