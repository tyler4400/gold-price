# 部署与 GitHub Actions

生产站由 [Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) 连接本仓库，在 push 到默认分支 `main` 时自动构建并部署。这条线和合成大模型（`tyler4400/merge-models`）相同：不经过 GitHub Actions 推代码，也不使用 Actions 部署 Worker。仓库里的 Actions 只负责 CI、定时抓取和保活。

线上 Worker 名称为 `gold-price`，workers.dev 地址为 `https://gold-price.tyler4400g.workers.dev`。本文不再使用 `YOUR_WORKER_HOST`、`YOUR_D1_DATABASE_ID` 占位符。不要把 token 或 `INGEST_TOKEN` 写入仓库、issue、日志或 `.dev.vars`。

## 1. Workers Builds

Git 集成已连接到 `tyler4400/gold-price`，生产分支为 `main`。配置与合成大模型对齐，并按本仓库的包管理器改用 pnpm：

| 项 | gold-price | 对照：merge-models |
| --- | --- | --- |
| 生产分支 | `main` | `master` |
| 根目录 | `/` | `/` |
| 构建命令 | `pnpm run build` | `npm run build` |
| 部署命令 | `npx wrangler deploy` | `npx wrangler deploy` |
| 预览命令 | `npx wrangler preview` | `npx wrangler preview` |
| 构建缓存 | 开启 | 开启 |
| 路径过滤 | 包含 `*`，无排除 | 包含 `*`，无排除 |
| 预览构建 | 开启（其它分支） | 开启 |

合并到 `main` 会触发生产构建；其它分支的 push 只更新 Preview，不影响线上。不要新增 GitHub Actions 部署 workflow。构建使用的是已有账号级 Workers Builds token（与 one-ip 共用），不是仓库 secret。

构建命令会执行 `pnpm typecheck && vite build`，产物在 `dist/`。Wrangler 按 `wrangler.toml` 的 `[assets]` 把静态资源和 Worker API 一起发布。本地校验可用：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm run deploy`（`wrangler deploy`）仅在明确需要手动补发时使用，日常发布以 Workers Builds 为准。

## 2. D1

生产数据库名称是 `gold-price`，`database_id` 已写入顶层 `wrangler.toml` 的 `[[d1_databases]]`。保留 `binding = "DB"`、`database_name = "gold-price"` 和 `migrations_dir = "migrations"`。不要替换 `env.local` 的全零占位 ID。

D1 database ID 是资源标识，不是鉴权密钥。任何情况下都不能把 token 写入 `wrangler.toml`。

初始迁移 `0001_initial.sql` 已在远端应用，并由 Wrangler 的 `d1_migrations` 表跟踪。后续新增 `migrations/` 中的 SQL 后，在可信环境对生产库执行：

```bash
pnpm exec wrangler d1 migrations apply DB --remote
```

确认目标是生产数据库再执行。`pnpm db:migrate:local` 只改本地库。命令说明见 [Wrangler D1 文档](https://developers.cloudflare.com/workers/wrangler/commands/d1/)。

## 3. Worker 与 GitHub secrets

`INGEST_TOKEN` 同时存在于 Worker secret 和 GitHub 仓库的 Actions secret；两端必须相同。`INGEST_URL` 只在 GitHub 仓库 secret 中，值为 `https://gold-price.tyler4400g.workers.dev`（HTTPS origin，不带 `/api/ingest`、路径、查询参数、片段或凭据）。scrape job 把 `INGEST_URL` 映射为 `WORKER_BASE_URL`，把 `INGEST_TOKEN` 映射为同名环境变量。

轮换时在可信环境生成新的高强度随机值，同步更新 Worker secret 与 GitHub `INGEST_TOKEN`，再手动补跑 Scrape 验证。不要把值放在命令参数、文档、issue、日志、Git URL、前端代码或任何 `VITE_*` 变量中。不要把生产值写入 `.dev.vars`。不需要向 CI 提供 Cloudflare 凭据，也不需要名为 `WORKER_BASE_URL` 的仓库变量。

如需手动更新：

```bash
pnpm exec wrangler secret put INGEST_TOKEN
# 仅在交互提示中输入值
printf '%s' "$INGEST_TOKEN" | gh secret set INGEST_TOKEN --repo tyler4400/gold-price
printf '%s' 'https://gold-price.tyler4400g.workers.dev' | gh secret set INGEST_URL --repo tyler4400/gold-price
```

`wrangler secret put` 会立即创建一个新版本并部署，不要在即将被构建覆盖的窗口里误改其它绑定。

## 4. 验收

```bash
curl --fail-with-body 'https://gold-price.tyler4400g.workers.dev/healthz'
curl --fail-with-body 'https://gold-price.tyler4400g.workers.dev/api/latest'
```

健康检查应返回 `status: "ok"`；尚未抓取时 latest 的 `items` 为空属于正常情况。构建产物 `dist/`、`.wrangler/`、本地密钥文件和 `preview-api/` 均不提交到仓库。

在 **Actions → Scrape → Run workflow** 选择 `main` 并运行。合并本身只触发 CI 和（若有代码变更）Workers Builds，不触发 scrape 或 keepalive。

在运行详情中检查 **Check ingest secrets** 和 **Scrape and upload**：

- 任一 secret 为空，配置检查以非 0 退出，中文日志指向仓库 Settings 并说明 `INGEST_URL`、`INGEST_TOKEN` 的配置方式；不回显值，不执行抓取上报。
- CLI JSON 日志的 `summary.uploaded` 应为 `true`、`exit_code` 为 `0`，并包含 `accepted`、`updated`、`ignored` 计数。失败时查看 `error`、逐项 `failures` 或 `upload_error` 的脱敏摘要。
- 失败判定沿用现有 CLI：`sge_au9999` 和 `china_gold_base` 两项都失败、无有效记录或上报失败均退出非 0；一个关键项成功且上报成功即可通过，个别品牌失败不补造数据。

随后再查 `/api/latest`，确认 `items` 非空，包含 `sge_au9999`、`china_gold_base` 两个关键项，核对各项 `date`、`fetched_at` 和价格。若某关键项缺失，即使 job 因另一项成功而通过，也应按失败摘要排查对应来源并手动补跑。已有旧数据不会因源失败被删除，所以“存在该项”不等于“本轮刷新成功”；要同时检查日期和本轮摘要。节假日或源站未更新时不要把旧报价日期当作今天。

上报失败时先核对 URL 格式与两端密钥一致性、Worker secret 是否存在及远端迁移是否完成；401 常为鉴权不匹配，503 需检查服务端配置或数据库。修复后重新 **Run workflow**。不要将完整敏感配置贴入 issue 或日志。

## 5. 可选：绑定自定义域名

默认使用 workers.dev。若要绑定自定义域名，在 Cloudflare 控制台打开该 Worker 的 Settings → Domains & Routes → Add → Custom Domain，选择自己在 Cloudflare 管理的域名，等待 DNS 与证书生效。操作说明见 [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)。用自定义域名重新验证健康检查和查询接口，并把 GitHub 的 `INGEST_URL` 改成这个 HTTPS origin。

## 6. 调度、CI 与保活

| Workflow | 触发条件 | 权限与行为 |
| --- | --- | --- |
| Scrape | 每日 `30 1 * * *`（01:30 UTC / 北京时间 09:30）、`0 8 * * *`（08:00 UTC / 北京时间 16:00）；`workflow_dispatch` | `contents: read`；15 分钟超时；运行 `pnpm ingest -- --upload` |
| CI | 所有 `pull_request`；向 `main` 的 `push` | `contents: read`；依次执行 lint、typecheck、test、build，任一步失败即红；无需 secrets、Cloudflare 登录或上报 |
| Keepalive | 每月 1 日 `17 3 1 * *`（03:17 UTC / 北京时间 11:17）；`workflow_dispatch` | 仅 `actions: write`；5 分钟超时；列出本仓库所有 workflows，重新启用 `disabled_inactivity` 项 |

Scrape 与 CI 使用 Ubuntu runner、pnpm 10.32.1、Node.js 24 和 `pnpm install --frozen-lockfile`。Scrape/Keepalive 都没有 `push` 或 `pull_request` 触发。schedule 仅在默认分支生效，并可能延迟或因高负载丢失，不能承诺准点刷新；详见 [GitHub schedule 说明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)。

所有分支的定时与手动 scrape 共用 `gold-price-scrape` concurrency group，`cancel-in-progress: false`，不会因后到任务而取消正在上报的任务。后到任务进入等待；按 GitHub 默认队列语义，同组最多一个运行、一个等待，更新的等待任务可能替换旧的等待任务，并非无限 FIFO 队列。详见 [GitHub concurrency 说明](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)。

Keepalive 使用 GitHub 自动提供的工作流 token，通过 `github.rest.actions.enableWorkflow` 调用官方 `PUT /repos/{owner}/{repo}/actions/workflows/{workflow_id}/enable`，无需自行设置额外 secret。它不 checkout、不写保活文件、不创建空 commit、不修改默认分支历史，也不重新启用维护者手动停用的 workflow。API 权限见 [启用 workflow](https://docs.github.com/en/rest/actions/workflows#enable-a-workflow)。重新启用不会立即补抓数据，需要另行手动触发 Scrape。

**这不能保证 100% 自动自愈。** 公开仓库连续约 60 天没有仓库活动时，GitHub 会停用 scheduled workflows，Keepalive 自身也可能被停用。它只能在自身仍能运行时恢复其它因不活跃停用的 workflow，不能将 API 调用或定时运行视为一定重置不活跃计时。详见 [GitHub 停用说明](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows)。

维护者仍应每月检查最近成功运行时间和最新数据日期。若 Keepalive 也被停，在 Actions 页面选择该 workflow 并点 **Enable workflow**，再手动运行 Keepalive 与 Scrape；也可先做一次真实仓库活动，检查并启用仍被停用的 workflow 后手动触发。仅浏览 Actions 页面不保证恢复调度，不使用空 commit 或虚假数据文件保活。
