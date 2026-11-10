import { createServer, type Server, type RequestListener } from "node:http";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { snapshot } from "./preview-snapshot.ts";
import { ITEM_KEYS } from "../ingest/core.ts";

let server: Server | undefined;
let directory: string | undefined;
afterEach(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );
  if (directory) await rm(directory, { recursive: true, force: true });
  server = undefined;
  directory = undefined;
});
async function serve(handler: RequestListener) {
  directory = await mkdtemp(join(tmpdir(), "gold-snapshot-test-"));
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test server port");
  return `http://127.0.0.1:${address.port}`;
}
it("exports latest plus 11 × 4 histories using only unauthenticated GETs, including empty items", async () => {
  const requested: string[] = [];
  const origin = await serve((request, response) => {
    expect(request.method).toBe("GET");
    expect(request.headers.authorization).toBeUndefined();
    const url = new URL(request.url!, "http://localhost");
    requested.push(url.pathname + url.search);
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify(
        url.pathname === "/api/latest"
          ? { items: [] }
          : {
              item_key: url.searchParams.get("item"),
              range: url.searchParams.get("range"),
              unit: "CNY/g",
              from: "2026-01-01",
              to: "2026-11-10",
              points: [],
            },
      ),
    );
  });
  expect((await snapshot(origin, directory)).count).toBe(45);
  expect(requested).toHaveLength(45);
  expect(await readdir(directory!)).toHaveLength(45);
  for (const key of ITEM_KEYS) {
    for (const range of ["7d", "30d", "90d", "365d"]) {
      const data = JSON.parse(
        await readFile(
          join(directory!, `history-${key}-${range}.json`),
          "utf8",
        ),
      );
      expect(data).toMatchObject({ item_key: key, range, points: [] });
    }
  }
});
it("keeps existing snapshots unchanged if any history request fails", async () => {
  const origin = await serve((request, response) => {
    if (request.url === "/api/latest") response.end('{"items":[]}');
    else {
      response.statusCode = 503;
      response.end("{}");
    }
  });
  await writeFile(join(directory!, "latest.json"), "previous snapshot");
  await expect(snapshot(origin, directory)).rejects.toThrow("HTTP 503");
  expect(await readFile(join(directory!, "latest.json"), "utf8")).toBe(
    "previous snapshot",
  );
  expect(await readdir(directory!)).toEqual(["latest.json"]);
});
it("rejects HTML fallback without writing snapshots", async () => {
  const origin = await serve((_request, response) =>
    response.end("<html>SPA</html>"),
  );
  await expect(snapshot(origin, directory)).rejects.toThrow("JSON");
  expect(await readdir(directory!)).toEqual([]);
});
it("rejects credentials, remote origins and query parameters before fetching", async () => {
  for (const origin of [
    "https://example.com",
    "http://dev:placeholder@localhost:8787",
    "http://localhost:8787/?unexpected=1",
  ]) {
    await expect(snapshot(origin)).rejects.toThrow("loopback");
  }
});
