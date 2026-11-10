// 阶段①占位：无业务 API、数据库访问或抓取逻辑。
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/healthz") {
      return Response.json({ status: "ok", stage: "scaffold" });
    }
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return Response.json({ error: "API 尚未实现" }, { status: 404 });
    }
    return env.ASSETS.fetch(request);
  },
};
