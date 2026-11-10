import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ITEM_KEYS } from "../ingest/core.ts";
import { parseHistory, parseLatest, ranges } from "../src/lib/market.ts";

const defaultDirectory = fileURLToPath(
  new URL("../preview-api/", import.meta.url),
);
export async function snapshot(
  baseUrl = "http://127.0.0.1:8787",
  outDir = defaultDirectory,
) {
  const base = new URL(baseUrl);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/"
  ) {
    throw new Error(
      "Worker 地址必须是本地 loopback 根地址，不能包含凭据、路径、查询或片段。",
    );
  }
  const files = new Map<string, unknown>();
  async function get(path: string) {
    let response: Response;
    try {
      response = await fetch(new URL(path, base), {
        method: "GET",
        headers: { Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new Error("无法读取本地 Worker，请确认已启动且可访问。");
    }
    if (!response.ok)
      throw new Error(
        `快照请求失败（HTTP ${response.status}），原有快照未更新。`,
      );
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new Error("Worker 未返回有效 JSON，原有快照未更新。");
    }
  }
  files.set("latest.json", parseLatest(await get("/api/latest")));
  // All configured items, including ones absent from latest, must get all four ranges.
  for (const item of ITEM_KEYS) {
    for (const range of Object.keys(ranges)) {
      const history = parseHistory(
        await get(`/api/history?item=${item}&range=${range}`),
      );
      if (history.item_key !== item || history.range !== range)
        throw new Error("历史响应与请求不符，原有快照未更新。");
      files.set(`history-${item}-${range}.json`, history);
    }
  }
  // Finish every GET and validation before changing files. Each file is replaced by an atomic rename.
  const directory = resolve(outDir);
  await mkdir(directory, { recursive: true });
  for (const [name, value] of files) {
    const target = resolve(directory, name);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, target);
  }
  return { directory, count: files.size };
}

if (import.meta.main) {
  try {
    let baseUrl: string | undefined;
    let outDir: string | undefined;
    const args = process.argv.slice(2).filter((arg) => arg !== "--");
    for (let i = 0; i < args.length; i += 2) {
      const value = args[i + 1];
      if (!value || value.startsWith("--"))
        throw new Error(
          "用法：pnpm preview:snapshot [--base-url http://127.0.0.1:8787] [--out-dir /tmp/gold-preview-api]",
        );
      if (args[i] === "--base-url") baseUrl = value;
      else if (args[i] === "--out-dir") outDir = value;
      else throw new Error("仅支持 --base-url 和 --out-dir 参数。");
    }
    const result = await snapshot(baseUrl, outDir);
    console.log(
      `已写出 ${result.count} 个只读行情快照文件：${result.directory}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "生成快照失败。");
    process.exitCode = 1;
  }
}
