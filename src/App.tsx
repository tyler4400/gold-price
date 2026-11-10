import { ChartNoAxesCombined } from "lucide-react";
import { GithubLink } from "@/components/github-link";
import { ThemeToggleButton } from "@/components/theme/theme-toggle-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function App() {
  return (
    <div className="page-layout">
      {/* 两侧预留插槽；无可见文案，手机隐藏。 */}
      <aside className="side-slot" data-slot="left-aside" aria-hidden="true" />
      <div className="content-shell">
        <header className="flex items-center justify-between gap-4 border-b border-border py-5">
          <a
            href="/"
            aria-label="金价首页"
            className="flex items-center gap-2.5 rounded-md font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="size-2 rounded-full bg-gold" aria-hidden="true" />
            金价{" "}
            <span className="text-xs font-normal tracking-normal text-muted-foreground">
              gold-price
            </span>
          </a>
          <nav aria-label="外观与项目" className="flex items-center gap-1">
            <ThemeToggleButton />
            <GithubLink />
          </nav>
        </header>

        <main id="main-content" className="py-12 sm:py-16">
          <p className="mb-3 text-xs font-medium tracking-widest text-muted-foreground">
            公开金价 · 每日记录
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            让金价变化，一目了然。
          </h1>
          <p className="mt-5 max-w-xl text-sm leading-7 text-muted-foreground sm:text-base">
            在这里查看基础金价、品牌金价与历史走势。
            <br className="hidden sm:block" />
            完整行情页将在后续阶段接入，到价邮件提醒也将随后开放。
          </p>

          <Card className="mt-10">
            <CardHeader className="border-b border-border">
              <CardTitle>行情概览</CardTitle>
              <CardDescription>
                当前为界面预览，尚未接入金价数据。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 pt-6 text-center">
              <div className="mb-1 flex size-11 items-center justify-center rounded-xl border border-border bg-muted">
                <ChartNoAxesCombined
                  className="size-5 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
              <p className="text-sm font-medium">等待接入每日行情</p>
              <p className="max-w-sm text-sm leading-6 text-muted-foreground">
                接入后将展示上金所基础金价 Au99.99、
                <br className="hidden sm:block" />
                国际现货金参考价及各品牌足金饰品价。
              </p>
            </CardContent>
          </Card>
          <p className="mt-4 text-xs text-muted-foreground">
            每日更新计划 · 历史走势与到价提醒将在后续阶段补充
          </p>
        </main>

        <footer className="mt-auto flex flex-wrap justify-between gap-3 border-t border-border py-6 text-xs text-muted-foreground">
          <p>gold-price · 阶段①界面预览</p>
          <p>接入行情后，数据来源将在此统一列示。</p>
        </footer>
      </div>
      <aside className="side-slot" data-slot="right-aside" aria-hidden="true" />
    </div>
  );
}
