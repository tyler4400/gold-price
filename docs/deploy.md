# 部署与 GitHub Actions

阶段⑤已实现定时抓取、手动补跑、CI 和 API 保活。以下远端操作均由维护者在自己的本机执行；仓库 agent 不代为登录、创建远端资源、部署或设置 GitHub secrets。

准备 Node.js 24、pnpm 10.32.1、Cloudflare 账号及 GitHub 仓库管理权限。在项目根目录执行 `pnpm install --frozen-lockfile`。本文的 `YOUR_WORKER_HOST`、`YOUR_D1_DATABASE_ID` 都是占位符，执行前按实际部署替换；不要复制占位符作为生产配置。

## 1. 登录 Cloudflare

```bash
pnpm exec wrangler login
```

在浏览器中完成自己的账号授权。以下生产命令使用 `wrangler.toml` 顶层配置，不加 `--env local`。

## 2. 创建远端 D1 并配置绑定

```bash
pnpm exec wrangler d1 create gold-price
```

将返回的 `database_id` 填入 `wrangler.toml` 顶层 `[[d1_databases]]` 的 `YOUR_D1_DATABASE_ID`，保留 `binding = "DB"`、`database_name = "gold-price"` 和 `migrations_dir = "migrations"`。不要替换 `env.local` 的本地占位 ID。

D1 database ID 是资源标识，不是鉴权密钥；专用部署仓库通常可以将实际 ID 作为配置纳入版本控制，仍须由维护者决定。本仓库当前保留占位符；若保持通用模板形式，在自己的部署工作副本中替换即可。任何情况下都不能把 token 写入 `wrangler.toml`。

## 3. 应用远端迁移

```bash
pnpm exec wrangler d1 migrations apply DB --remote
```

确认目标是刚创建的生产数据库，再确认执行。该命令使用 `DB` 绑定及 `migrations/` 中的 SQL；Wrangler 跟踪已应用的迁移。`pnpm db:migrate:local` 仅修改本地库，不能替代这一步。命令说明见 [Wrangler D1 文档](https://developers.cloudflare.com/workers/wrangler/commands/d1/)。

## 4. 设置 Worker secret

在可信环境生成并妥善保存高强度随机密钥，然后执行：

```bash
pnpm exec wrangler secret put INGEST_TOKEN
```

只在交互提示中输入值。首次尚无同名 Worker 时，按 Wrangler 提示确认创建后设置 secret；完整应用在下一步部署。不要将值放在命令参数、文档、issue、日志、Git URL、前端代码或任何 `VITE_*` 变量中。不要把生产值写入 `.dev.vars`。稍后 GitHub 的 `INGEST_TOKEN` 必须与此处完全相同；轮换时同步两处并手动补跑验证。

## 5. 校验、构建并部署

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec wrangler deploy
```

所有校验成功后再部署。`pnpm build` 生成 `dist/`，Wrangler 按 `[assets]` 将静态资源与 Worker API 一起发布。记录部署返回的 Worker HTTPS origin，本文统一写作 `https://YOUR_WORKER_HOST`。

```bash
curl --fail-with-body 'https://YOUR_WORKER_HOST/healthz'
curl --fail-with-body 'https://YOUR_WORKER_HOST/api/latest'
```

健康检查应返回 `status: "ok"`；首次尚未抓取时 latest 的 `items` 为空属于正常情况。构建产物 `dist/`、`.wrangler/`、本地密钥文件和 `preview-api/` 均不提交到仓库。

## 6. 可选：绑定自定义域名

在 Cloudflare 控制台打开该 Worker 的 Settings → Domains & Routes → Add → Custom Domain，选择自己在 Cloudflare 管理的域名，等待 DNS 与证书生效。操作说明见 [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)。用自定义域名重新验证上面的健康检查和查询接口，后续 `INGEST_URL` 可以使用这个 HTTPS origin。

## 7. 配置 GitHub Actions secrets

打开 GitHub 仓库 **Settings → Secrets and variables → Actions → New repository secret**，设置以下两个 repository secrets（不是 Variables）：

| Secret 名称 | 内容 | scrape job 中的环境变量 |
| --- | --- | --- |
| `INGEST_URL` | 已部署 Worker 的 HTTPS origin，如 `https://YOUR_WORKER_HOST`；无路径、查询参数、片段或凭据 | `WORKER_BASE_URL` |
| `INGEST_TOKEN` | 与 Worker secret 相同的值 | `INGEST_TOKEN` |

不把 `/api/ingest` 拼到 `INGEST_URL` 中，CLI 会自行添加接口路径。不需要额外设置名为 `WORKER_BASE_URL` 的仓库变量或 secret，也不需要向 CI 提供 Cloudflare 凭据。密钥经环境变量传给现有 CLI，仅在上报的 Authorization header 中使用，不写入 URL、日志或产物。也可用本机已登录的 GitHub CLI 交互写入（不要把值放进命令参数或历史记录）：

```bash
gh secret set INGEST_URL --repo tyler4400/gold-price
gh secret set INGEST_TOKEN --repo tyler4400/gold-price
```

在提示中粘贴对应值。agent 不代为设置这些 secrets。

## 8. 手动抓取与验收

将 workflows 合并到默认分支 `main` 后，在 **Actions → Scrape → Run workflow** 选择 `main` 并运行。合并本身仅触发 CI，不触发 scrape 或 keepalive；缺少 secret 不会导致合并瞬间自动抓取失败，但后续定时/手动 scrape 会明确失败。

在运行详情中检查 **Check ingest secrets** 和 **Scrape and upload**：

- 任一 secret 为空，配置检查以非 0 退出，中文日志指向仓库 Settings 并说明 `INGEST_URL`、`INGEST_TOKEN` 的配置方式；不回显值，不执行抓取上报。
- CLI JSON 日志的 `summary.uploaded` 应为 `true`、`exit_code` 为 `0`，并包含 `accepted`、`updated`、`ignored` 计数。失败时查看 `error`、逐项 `failures` 或 `upload_error` 的脱敏摘要。
- 失败判定沿用现有 CLI：`sge_au9999` 和 `china_gold_base` 两项都失败、无有效记录或上报失败均退出非 0；一个关键项成功且上报成功即可通过，个别品牌失败不补造数据。

随后查询最新价：

```bash
curl --fail-with-body 'https://YOUR_WORKER_HOST/api/latest'
```

确认 `items` 非空，包含 `sge_au9999`、`china_gold_base` 两个关键项，核对各项 `date`、`fetched_at` 和价格。若某关键项缺失，即使 job 因另一项成功而通过，也应按失败摘要排查对应来源并手动补跑。已有旧数据不会因源失败被删除，所以“存在该项”不等于“本轮刷新成功”；要同时检查日期和本轮摘要。节假日或源站未更新时不要把旧报价日期当作今天。

上报失败时先核对 URL 格式与两端密钥一致性、Worker secret 是否存在及远端迁移是否完成；401 常为鉴权不匹配，503 需检查服务端配置或数据库。修复后重新 **Run workflow**。不要将完整敏感配置贴入 issue 或日志。

## 9. 调度、CI 与保活

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
