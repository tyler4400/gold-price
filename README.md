# gold-price

公开金价走势页 + 到价邮件提醒。汇总上金所基础金价 Au99.99、国际现货金参考价和品牌足金饰品价，并保留每日历史记录。v1 的「设到价提醒」只做按钮占位，点击提示「即将上线」；发信、邮箱验证和订阅操作等用户选定邮件服务商后再接。

**当前完成阶段①–⑤：脚手架、本机抓取、D1/Worker API、完整行情前端，以及 GitHub Actions 定时抓取、保活与 CI。** 首页展示基础报价、ECharts 历史走势和八个品牌的足金饰品价，直接请求同源 latest/history API。加载、空库、请求失败及重试、缺失品牌、无前值和非今日数据均有独立提示。提醒按钮只提示「即将上线」。定时任务与首次部署配置见 [部署文档](docs/deploy.md)；订阅者和提醒规则仅建表，没有订阅 API、邮箱验证或发信。

## 技术栈

- 前端：React + TypeScript + Vite + Tailwind CSS 4 + shadcn/ui 基础组件 + lucide-react。
- 服务端：Cloudflare Workers 托管前端与 API，D1 保存每日金价和后续订阅。
- 图表：ECharts 按需加载，默认 Au99.99 近一个月，支持四个日历范围及报价品种切换。
- 数据更新：由 GitHub Actions 定时抓取，再经 HTTPS 上报 Worker；数据不提交回仓库。

## 来源与许可证

部分前端脚手架与视觉/交互代码改自 [tyler4400/one-ip](https://github.com/tyler4400/one-ip)，该仓库 fork 自上游 [zhihui-hu/one-ip](https://github.com/zhihui-hu/one-ip)。本仓库采用 **AGPL-3.0**（包元数据标识 `AGPL-3.0-only`），与上游许可证一致，全文见 [LICENSE](LICENSE)。

改编范围包括 Primer 亮暗配色、1000px 布局思路、主题存储与系统主题订阅、圆形 View Transition、GitHub 链接、shadcn/ui button/card 和 Vite 配置。主题状态改为 React 外部存储；移除了 IP 诊断、测速、Whois、多语言、Docker 等业务。依赖的许可证仍以各自声明为准。

## 本地开发

需要 Node.js 24+、pnpm 10.32.1（`packageManager` 已固定版本）。

```bash
pnpm install
pnpm dev
```

打开 `http://127.0.0.1:5173`。这会启动带热更新的行情前端，`/api` 自动代理到本地 Worker `http://127.0.0.1:8787`；需按下文启动 Worker 才能读取行情，未启动时页面会明确报错并提供重试。无需 Cloudflare 账号。右上角只有主题与 GitHub 两个图标；主题按钮按「跟随系统 → 浅色 → 深色 → 跟随系统」循环，选择写入 `localStorage`，默认跟随系统。存储不可用时仍可切换；减少动态效果设置开启时禁用扩散动画。

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm preview
```

`build` 先做类型检查，再输出前端到 `dist/`；`preview` 只预览前端构建产物，不提供行情 API；查看完整行情请使用下面的 Worker 地址。

本地 Worker + D1（无需 Cloudflare 账号）：

1. 在项目根目录创建 `.dev.vars`，只放本地开发用假密钥：

   ```dotenv
   INGEST_TOKEN=dev-ingest-token
   ```

   `.dev.vars` / `.env` 及环境变体均已忽略，勿提交。`local` 环境读取 `.dev.vars.local` 时会优先于 `.dev.vars`，使用其中一个即可；不要配置真实生产密钥。没有配置密钥时 `/api/ingest` 返回 503。

2. 先构建静态资源，再应用本地迁移，最后启动：

   ```bash
   pnpm build
   pnpm db:migrate:local
   pnpm worker:dev
   ```

   `db:migrate:local` 等价于 `wrangler d1 migrations apply DB --env local --local`；`worker:dev` 等价于 `wrangler dev --env local --local`。两者使用同一个本地 D1，数据存于已忽略的 `.wrangler/`。本地 ID 是全零占位；生产 D1 的 `database_id` 写在顶层 `wrangler.toml`，不要改 `env.local`。打开 **`http://127.0.0.1:8787`** 即可查看完整行情页，静态资源与 API 同源。前端改动后需重新 build；开发热更新则另开终端 `pnpm dev` 后看 5173。空库会显示空状态，已有本地数据会直接展示。结束预览按 Ctrl+C 关闭 Worker。

3. 另开终端，真实抓取并上传到本地 Worker：

   ```bash
   INGEST_TOKEN=dev-ingest-token WORKER_BASE_URL=http://127.0.0.1:8787 pnpm ingest -- --upload
   curl http://127.0.0.1:8787/healthz
   curl http://127.0.0.1:8787/api/latest
   curl 'http://127.0.0.1:8787/api/history?item=sge_au9999&range=30d'
   ```

   CLI 的环境变量需单独提供，`.dev.vars` 是 Wrangler 的配置，不会自动注入 CLI。成功时 `summary.uploaded=true`，并有 `accepted/updated/ignored`。真实源偶尔失败会输出逐项摘要；至少一个关键项成功且上报成功才退出 0。历史库刚开始只有已抓取日期，不补造历史。

   验证错误凭据（预期 401）：

   ```bash
   curl -i -X POST http://127.0.0.1:8787/api/ingest \
     -H 'Authorization: Bearer dev-wrong-token' \
     -H 'Content-Type: application/json' --data '{"records":[]}'
   ```

`GET /healthz` 返回 `{"status":"ok","stage":"api"}`。最新价按每项最新数据日与上一有效数据日计算涨跌；历史范围为上海时区今天结束的 7/30/90/365 个日历日。写接口限制 64 KiB、1–100 条、六字段、item 和来源白名单，整批校验后事务 upsert，仅接受不早于库内的抓取时间。错误统一为 `{ error: { code, message } }`。`/api` 和未知 `/api/*` 返回 JSON 404，不回退到 SPA。

`pnpm test` 同时运行原有 Node ingest fixture 测试、Vitest + Miniflare 的真实本地 D1/Worker 测试，以及前端契约/涨跌展示和快照脚本测试；测试不依赖外网或 Cloudflare 账号，不接触开发用持久数据库。

测试固定使用与当前 Wrangler 一致的 Miniflare 版本，通过其 `convertV4MiniflareOptions` 接口构造本地运行配置；保持与 `wrangler.toml` 相同的兼容日期和 Node.js 兼容标记。

如沙箱内用户配置目录只读，可在迁移和 Worker 命令前加 `XDG_CONFIG_HOME=/tmp/gold-price-config WRANGLER_LOG_PATH=/tmp/gold-price-wrangler-logs WRANGLER_SEND_METRICS=false`；数据库仍保存在项目 `.wrangler/` 中。

如运行环境的包管理器缓存目录只读，可临时使用 `COREPACK_HOME=/tmp/gold-price-corepack pnpm install --store-dir /tmp/gold-price-pnpm-store`；普通开发机无需此设置。

## CVM 静态预览快照（阶段④）

先按上文启动本地 Worker，再在另一个终端运行：

```bash
pnpm preview:snapshot
# 可配置本地 Worker 根地址与输出目录：
pnpm preview:snapshot --base-url http://127.0.0.1:8787 --out-dir /tmp/gold-preview-api
```

脚本只发无鉴权 GET，不读取或需要 token。默认写入已忽略的 `preview-api/`：`latest.json` 和 `history-<item_key>-<range>.json`（11 个 item × 4 个范围，包括空数据项，共 45 个文件）。全部请求与结构校验成功后才开始写入，每个文件通过临时文件重命名替换；任何网络/响应错误都以非 0 退出并保留原快照。文件写入过程中不要对外切换目录；完整导出后再复制到 CVM。自定义仓库内输出目录时也须加入忽略规则，真实抓取 JSON 不提交到 Git。

这只是手动静态预览，后续不会自行刷新；日期仍是报价日期，不伪标今日。正常 Worker 模式仍直接查询 D1。以下 nginx 示例假设构建文件在 `/srv/gold-price/dist/`，快照文件在 `/srv/gold-price/preview-api/`；仅为配置说明，本阶段不上传或部署。

```nginx
# 放在 http {} 中：白名单阻止任意文件路径拼接。
map $arg_item $snapshot_item {
    default "";
    ~^(sge_au9999|xau_cny_g|china_gold_base|china_gold_jewelry|lukfook_jewelry|chow_sang_sang_jewelry|chow_tai_fook_jewelry|lao_feng_xiang_jewelry|lao_miao_jewelry|chow_tai_seng_jewelry|caibai_jewelry)$ $arg_item;
}
map $arg_range $snapshot_range {
    default "";
    "" 30d;
    7d 7d;
    30d 30d;
    90d 90d;
    365d 365d;
}
server {
    listen 80;
    server_name _;
    root /srv/gold-price/dist;

    location = /api/latest {
        root /srv/gold-price;
        default_type application/json;
        add_header Cache-Control "no-store" always;
        error_page 404 = @api_json404;
        try_files /preview-api/latest.json =404;
    }
    location = /api/history {
        root /srv/gold-price;
        default_type application/json;
        add_header Cache-Control "no-store" always;
        error_page 404 = @api_json404;
        if ($snapshot_item = "") { return 404; }
        if ($snapshot_range = "") { return 404; }
        try_files /preview-api/history-$snapshot_item-$snapshot_range.json =404;
    }
    location = /api {
        default_type application/json;
        return 404 '{"error":{"code":"not_found","message":"接口不存在"}}';
    }
    location ^~ /api/ {
        default_type application/json;
        return 404 '{"error":{"code":"not_found","message":"接口不存在"}}';
    }
    location @api_json404 {
        default_type application/json;
        return 404 '{"error":{"code":"not_found","message":"快照不存在或参数无效"}}';
    }
    location / { try_files $uri $uri/ /index.html; }
}
```

nginx 用 `$arg_item` / `$arg_range` 单独取参数，参数顺序不影响匹配。例如 `/api/history?range=30d&item=sge_au9999` 读取 `history-sge_au9999-30d.json`。遗漏 range 默认 30d；非法 item/range、缺失文件及所有未知 `/api` 路径均返回 JSON 404，不回退首页 HTML。静态预览没有 ingest 写接口。

## 本机抓取（阶段②）

```bash
pnpm ingest:dry
# 以下两种也默认/显式 dry-run：
pnpm ingest
pnpm ingest -- --dry-run
```

需要外网，不需要密钥；输出 JSON 包含六字段成功记录、逐项失败摘要、日期降级/汇率说明及退出状态。dry-run 绝不调用 ingest POST。部分源可能超时或反爬，失败不会填假值，也不会清空其它有效项。ingest 测试使用保存的 fixtures，测试禁止外网访问。

关键项为 `sge_au9999` 和 `china_gold_base`：任一成功可退出 0；两项全失败或没有有效记录则退出 1。中国黄金的基础与饰品价独立输出。价格为舍入至分的 JSON number；`.00` 不作为字符串尾零保存。

仅显式 `pnpm ingest -- --upload` 启用上报客户端。需由运行环境提供 `INGEST_TOKEN` 与 `WORKER_BASE_URL`（例如 `https://YOUR_WORKER_HOST`，不能带凭据或查询参数）；缺配置立即失败。密钥只进入 Authorization header，不进入 URL、日志或文件。本地开发额外允许 `http://127.0.0.1` 与 `http://localhost`（可带端口）；其它地址必须是 HTTPS origin。上报失败，或两关键项都失败，即使其它项上传成功也退出非 0。

每请求默认 15 秒超时，周生生放宽到 30 秒（均含响应读取）；最多尝试 3 次（首次 + 2 次重试），指数退避 1/2 秒；细节、来源选择和国际报价时效阈值见 [adapter 说明](ingest/adapters/README.md)，样本来源见 [fixtures](ingest/fixtures/README.md)。

## 目录

| 路径               | 用途                                    |
| ------------------ | --------------------------------------- |
| `src/`             | 中文行情卡、历史图表、品种汇总表、来源页脚及主题组件 |
| `scripts/preview-snapshot.ts` | CVM 静态预览的只读快照导出 |
| `worker/`          | 静态资源、健康检查、查询与鉴权上报 API                  |
| `ingest/` | 阶段② adapters、CLI、上报客户端、离线 fixtures 与单测 |
| `migrations/`      | 三表的正式 D1 SQL 迁移           |
| `wrangler.toml`    | 静态资源配置、生产自定义域名、Workers Observability、生产 D1 及本地 D1 绑定 |
| `docs/`            | 架构、产品说明和现有视觉稿              |

## 部署与自动化

完整说明见 [部署文档](docs/deploy.md)。生产站通过 Cloudflare Workers Builds 监听 `main` 的 push，自动执行 `pnpm run build` 与 `npx wrangler deploy`，不经过 GitHub Actions 部署。线上地址是 [`https://daily-gold.tyler4400.com/`](https://daily-gold.tyler4400.com/)，workers.dev 备用地址 `https://gold-price.tyler4400g.workers.dev` 仍指向同一 Worker。`INGEST_TOKEN` 与 `INGEST_URL` 分别写在 Worker secret 和仓库 Actions secrets 中，不要写入仓库。

Scrape 每日两组时段运行：UTC 01:30 / 02:15 / 03:15 和 08:15 / 08:45 / 09:30（北京时间 09:30 / 10:15 / 11:15 和 16:15 / 16:45 / 17:30），每组提供三次机会并避开整点，也可手动补跑。同日同项按 `(date, item_key)` upsert，旧抓取不会覆盖新抓取，失败项不写入；公开仓库使用标准 `ubuntu-latest` runner，新增运行分钟仍[免费](https://docs.github.com/en/actions/concepts/billing-and-usage)。不在 push/PR 时触发，合并本身不会抓取。GitHub Secret `INGEST_URL` 映射为 CLI 的 `WORKER_BASE_URL`，`INGEST_TOKEN` 映射为同名环境变量；缺配置会明确失败并给出中文提示。CI 在 PR 和 main push 上运行 lint、typecheck、test、build，无需密钥。Keepalive 每月通过 API 恢复因不活跃停用的 workflow，不创建提交；若自身也被停用，仍需维护者启用并补跑，详见部署文档。

## 文档与阶段

- [部署与 Actions](docs/deploy.md)：Workers Builds、密钥映射、抓取验收、调度与保活局限。
- [架构设计](docs/architecture.md)：数据流、表结构、API、数据源、失败策略、安全与运维。
- [项目说明书](docs/spec.md)：v1 范围、页面、提醒规则、数据项与后续验收。
- [视觉稿](docs/mockups/)：保留原有七张图，仅作设计参考，不代表已实现。

阶段①脚手架与文档 → 阶段②数据源 adapters → 阶段③ D1 与 Worker API → 阶段④完整行情页 → 阶段⑤定时抓取与保活。邮件验证和发信另待服务商选定；实时行情属于 v2。
