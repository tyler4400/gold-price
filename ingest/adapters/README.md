# 数据源 adapters（阶段②）

本机入口 `pnpm ingest:dry`（或 `pnpm ingest -- --dry-run`）；`pnpm ingest` 也默认 dry-run。仅 `--upload` 启用上报客户端，阶段③的 Worker 接口尚未实现。测试 `pnpm test` 只读取仓库 fixtures，不访问网络。

每个源一个 adapter，返回 `{ records, failures, notes }`。成功记录严格只有 `date/item_key/price/unit/source_url/fetched_at` 六字段；价格是舍入至分的 JSON number（JSON 不保留 `.00` 尾零），单位 `CNY/g`。失败、日期降级说明和汇率来源放在旁边，不进入上报记录。明确的旧报价日期保持原值，不改写为当天，不生成历史。

## 请求与解析

| adapter | 请求 / 选择 | 日期及展示页 |
| --- | --- | --- |
| `sina.ts` | 三个 GET，`Referer: https://finance.sina.com.cn`，GB18030；固定赋值变量名、CSV 字段数、字段位置及行情名称 | Au99.99：[展示页](https://finance.sina.com.cn/futures/quotes/AU9999.shtml)；国际：[展示页](https://finance.sina.com.cn/futures/quotes/XAU.shtml)；均使用行情日期 |
| `china-gold.ts` | POST `https://www.chnau99999.com/page/board`，空字符串 body，`Content-Length: 0`；`data.cur` 基础金价，`data.accessories` 足金饰品，逐项校验 | 实抓响应无报价日期，使用抓取时刻 Asia/Shanghai 日期并输出 notes；[展示页](https://www.chnau99999.com/page/goldPrice) |
| `lukfook.ts` | GET `https://www.lukfook.com/api/goldprice`；仅 `data.cn.data` 的 `足金999(克)`，缺该产品才选 `足金(克)`；取 `賣出(RMB)`，不取換購、香港或金条；首选产品空价按失败处理 | API 无报价日期，使用上海抓取日期并输出 notes；[内地金价展示页](https://www.lukfook.com/sc/page/goldprice) |
| `chow-sang-sang.ts` | GET `https://cn.chowsangsang.com/gold-info`；DOM 定位唯一 `gold-info-page`，仅 JSON.parse `:gold-prices` 属性，精确 `足金饰品 (每克）` → `卖出`；挑战页失败，不执行 JS | 组件 `time` 的报价日期，缺失时上海抓取日期并输出 notes；同 URL 展示 |
| `brands.ts` | 一次 GET `https://www.huangjinjiage.cn/pinpaijinjia.html`，GBK；DOM 逐表按表头定位品牌、产品、价格、日期；逐品牌校验 | 使用各行日期；同 HTTPS URL 展示 |

### 新浪字段与国际折算

索引从 0 开始，根据 2026-11-10 保存的实抓响应固定：

- `gds_AU9999` / `hf_XAU`：14 列；`[0]` 当前价，`[6]` 北京时间，`[12]` 报价日期，`[13]` 分别为 `沪金99` / `伦敦金（现货黄金）`。
- `fx_susdcny`：18 列；`[0]` 北京时间，`[1]` 买价，`[2]` 卖价，`[9]` 为 `在岸人民币`，`[17]` 报价日期。使用 `[1]` 的人民币/美元买价作为统一参考口径；实抓买/卖价分别为 6.6678 / 6.6683。[新浪 USDCNY 展示页](https://finance.sina.com.cn/money/forex/hq/USDCNY.shtml) 明确标为美元兑人民币，结合固定 `fx_susdcny` 代码确认方向。
- 折算：`hf_XAU[0] × fx_susdcny[1] / 31.1034768`，最后一步舍入到两位小数。汇率来源写入 dry-run notes。
- 不接受缺行情/空值/名称变化/买卖倒挂；汇率限 1–20 CNY/USD，用于发现反向或异常量纲，不作为备用汇率。
- 两输入必须同一上海报价日期，时间相差不超过 6 小时，任一不早于抓取时刻 36 小时、不超前超过 5 分钟。超过即 `stale`；这意味着周末较旧行情可能不生成参考值，宁缺不拼接。Au99.99 与品牌的明确旧日期可保留。

### 备用品牌表选择

列名白名单：`品牌`、`产品`、`价格/今日价格`、`更新时间/报价时间`；现有源价格单元格自带 `元/克`，严格解析整个单元格。也支持独立 `单位` 列，值必须是 `元/克`。日期和纯度即使在价格前面也不会被当成价格。重复目标行、表头歧义、未知产品、合并单元格、错误单位或无效日期均不生成对应项。

| item | 精确品牌别名 | 精确零售产品名 |
| --- | --- | --- |
| `chow_tai_fook_jewelry` | 周大福 | 首饰黄金价格 |
| `lao_feng_xiang_jewelry` | 老凤祥 | 黄金价格 |
| `lao_miao_jewelry` | 老庙黄金、老庙 | 黄金价格 |
| `chow_tai_seng_jewelry` | 周大生 | 黄金价格 |
| `caibai_jewelry` | 菜百首饰、菜百黄金 | 足金价格 |

`黄金价格` 是此源对应品牌零售表的既有标签，旁边投资金条、换购、回收行不会入选。菜百的 `足金价格` 与 `足金999价格` 分开，固定选前者，不把纯度更高产品或饰品金条混入。单品牌失败不会抹去其它有效品牌。

### 六福展示页核实

采用 **https://www.lukfook.com/sc/page/goldprice**。2026-11-10 核实该官网简体页面展示“内地金价”“人民币RMB”“卖出/克”以及“足金999/足金”，符合内地零售报价跳转用途；其 HTML 有动态模板占位，采集仍用官方 API。没有把 API 当作展示链接，也没有退回首页。

## 超时、重试与失败

每次 HTTP 请求（含读取 body）独立 15 秒超时，最多重试 2 次，退避 250/500ms；429/5xx 可重试并参考 Retry-After（等待上限 5 秒），网络/超时可重试，普通 4xx、解码/解析/价格错误不重试。禁止自动重定向，防止上报凭据被转发。源请求并发，单项与单源失败隔离。

错误分类：`timeout/network/http/encoding/structure/price/date/stale/currency/challenge`；上报另有 `config/upload`。摘要包含源、item、分类、说明及 UTC 抓取时刻，不打印原始异常、响应正文、Authorization 或环境变量值。

关键项固定为 `sge_au9999` 与 `china_gold_base`：至少一个有效且有记录时，dry-run 可退出 0；两项全失败或无有效记录退出 1。非 dry-run 还要求配置有效且上报成功；即使上传了其它有效品牌，两关键项全失败仍退出 1。

上报需环境变量 `INGEST_TOKEN`、`WORKER_BASE_URL`（仅 HTTPS origin，例如 `https://YOUR_WORKER_HOST`），POST `/api/ingest`，Authorization Bearer header，body `{ records: [...] }`。客户端校验未来接口返回的 `accepted/updated/ignored` 计数；阶段②未实现该接口、持久化、Actions 或部署。

保存样本及衍生负例见 [fixtures 说明](../fixtures/README.md)，整体设计见 [架构](../../docs/architecture.md)。
