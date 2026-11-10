# gold-price

公开金价走势页 + 到价邮件提醒。计划汇总上金所基础金价 Au99.99、国际现货金参考价和品牌足金饰品价，并保留每日历史记录。v1 的「设到价提醒」只做按钮占位，点击提示「即将上线」；发信、邮箱验证和订阅操作等用户选定邮件服务商后再接。

**当前完成阶段①脚手架与阶段②本机数据抓取。** 可以运行数据源 adapters、离线测试和真实 dry-run；前端仍为中文空状态首页，可切换主题、打开 GitHub，或通过本地 Worker 预览静态资源和健康检查。尚无行情前端、图表、数据库表、业务 API、提醒按钮或邮件功能。

## 技术栈

- 前端：React + TypeScript + Vite + Tailwind CSS 4 + shadcn/ui 基础组件 + lucide-react。
- 服务端目标：Cloudflare Workers 托管前端与 API，D1 保存每日金价和后续订阅。
- 图表：计划使用 ECharts，阶段④再引入。
- 数据更新：计划由 GitHub Actions 定时抓取，再经 HTTPS 上报 Worker；数据不提交回仓库。

## 来源与许可证

部分前端脚手架与视觉/交互代码改自 [tyler4400/one-ip](https://github.com/tyler4400/one-ip)，该仓库 fork 自上游 [zhihui-hu/one-ip](https://github.com/zhihui-hu/one-ip)。本仓库采用 **AGPL-3.0**（包元数据标识 `AGPL-3.0-only`），与上游许可证一致，全文见 [LICENSE](LICENSE)。

改编范围包括 Primer 亮暗配色、1000px 布局思路、主题存储与系统主题订阅、圆形 View Transition、GitHub 链接、shadcn/ui button/card 和 Vite 配置。主题状态改为 React 外部存储；移除了 IP 诊断、测速、Whois、多语言、Docker 等业务。依赖的许可证仍以各自声明为准。

## 本地开发

需要 Node.js 24+、pnpm 10.32.1（`packageManager` 已固定版本）。

```bash
pnpm install
pnpm dev
```

打开 `http://127.0.0.1:5173`。这会启动带热更新的前端壳，不需要 Cloudflare 账号、密钥或数据库。右上角只有主题与 GitHub 两个图标；主题按钮按「跟随系统 → 浅色 → 深色 → 跟随系统」循环，选择写入 `localStorage`，默认跟随系统。存储不可用时仍可切换；减少动态效果设置开启时禁用扩散动画。

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm preview
```

`build` 先做类型检查，再输出前端到 `dist/`；`preview` 只预览前端构建产物。

本地 Worker 占位预览：

```bash
pnpm build
pnpm worker:dev
```

打开 `http://127.0.0.1:8787`，`GET /healthz` 返回 `{"status":"ok","stage":"scaffold"}`。`worker:dev` 等价于 `wrangler dev --env local --local`，使用无 D1 的本地环境，不登录、不部署。前端改动后需要重新 build。`/api/*` 统一返回 404；`/api/latest`、`/api/history`、`/api/ingest` 仍未实现。本地环境不连接真实 D1，也没有迁移 SQL。

Wrangler 可能提示顶层 `DB` 绑定未配置到 `env.local`；这是阶段①有意保留的环境差异，不影响静态资源或健康检查。阶段③接入数据库时再补本地绑定。

如运行环境的包管理器缓存目录只读，可临时使用 `COREPACK_HOME=/tmp/gold-price-corepack pnpm install --store-dir /tmp/gold-price-pnpm-store`；普通开发机无需此设置。

## 本机抓取（阶段②）

```bash
pnpm ingest:dry
# 以下两种也默认/显式 dry-run：
pnpm ingest
pnpm ingest -- --dry-run
```

需要外网，不需要密钥；输出 JSON 包含六字段成功记录、逐项失败摘要、日期降级/汇率说明及退出状态。dry-run 绝不调用 ingest POST。部分源可能超时或反爬，失败不会填假值，也不会清空其它有效项。`pnpm test` 使用保存的 fixtures，测试禁止外网访问。

关键项为 `sge_au9999` 和 `china_gold_base`：任一成功可退出 0；两项全失败或没有有效记录则退出 1。中国黄金的基础与饰品价独立输出。价格为舍入至分的 JSON number；`.00` 不作为字符串尾零保存。

仅显式 `pnpm ingest -- --upload` 启用上报客户端。需由运行环境提供 `INGEST_TOKEN` 与 `WORKER_BASE_URL`（例如 `https://YOUR_WORKER_HOST`，不能带凭据或查询参数）；缺配置立即失败。密钥只进入 Authorization header，不进入 URL、日志或文件。阶段③接口尚未实现，因此本阶段使用 dry-run 验收，无需实际上报。上报失败，或两关键项都失败，即使其它项上传成功也退出非 0。

每请求 15 秒超时、最多 2 次重试；细节、来源选择和国际报价时效阈值见 [adapter 说明](ingest/adapters/README.md)，样本来源见 [fixtures](ingest/fixtures/README.md)。

## 目录

| 路径               | 用途                                    |
| ------------------ | --------------------------------------- |
| `src/`             | 中文前端壳、主题、布局、基础组件        |
| `worker/`          | 静态资源与健康检查占位                  |
| `ingest/` | 阶段② adapters、CLI、上报客户端、离线 fixtures 与单测 |
| `migrations/`      | 阶段③ D1 迁移预留，仅说明文件           |
| `wrangler.toml`    | 静态资源配置、D1 占位及无 D1 的本地环境 |
| `docs/`            | 架构、产品说明和现有视觉稿              |

## 部署概要（后续阶段由维护者自行执行）

**当前不能直接按此部署完整产品。** 阶段③补齐 API、迁移 SQL 后，维护者在自己的环境完成 Cloudflare 授权，依次执行：

```bash
pnpm exec wrangler d1 create gold-price
# 在 wrangler.toml 中替换 YOUR_D1_DATABASE_ID；不要填写任何 secret。
pnpm exec wrangler d1 migrations apply gold-price --local
pnpm exec wrangler d1 migrations apply gold-price --remote
pnpm exec wrangler secret put INGEST_TOKEN
pnpm build
pnpm exec wrangler deploy
```

`wrangler secret put` 使用交互式输入；不要把真实 token 放进命令参数、文档或配置。阶段⑤再配置 GitHub Secret `INGEST_TOKEN`、Worker 地址与定时任务。详细顺序、鉴权和保活设计见 [架构文档](docs/architecture.md#部署与密钥配置后续由维护者执行)。这里的命令只用于说明，阶段①不执行创建、迁移、密钥设置或部署。

## 文档与阶段

- [架构设计](docs/architecture.md)：数据流、表结构、API、数据源、失败策略、安全与运维。
- [项目说明书](docs/spec.md)：v1 范围、页面、提醒规则、数据项与后续验收。
- [视觉稿](docs/mockups/)：保留原有七张图，仅作设计参考，不代表已实现。

阶段①脚手架与文档 → 阶段②数据源 adapters → 阶段③ D1 与 Worker API → 阶段④完整行情页 → 阶段⑤定时抓取与保活。邮件验证和发信另待服务商选定；实时行情属于 v2。
