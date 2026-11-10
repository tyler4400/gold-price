# D1 迁移

`0001_initial.sql` 创建 daily_prices、subscribers、alert_rules 及约束/索引。后两表仅预留，不提供业务写入或公开 API。

本地运行 `pnpm build`、`pnpm db:migrate:local`、`pnpm worker:dev`；迁移和 Worker 使用相同 local 环境与默认 `.wrangler/` 持久目录。Wrangler 跟踪已应用迁移，可重复运行迁移命令。测试使用相同 SQL，在临时 Miniflare D1 中执行。

远端创建、迁移与部署仅由维护者自行执行，见 [README](../README.md)。
