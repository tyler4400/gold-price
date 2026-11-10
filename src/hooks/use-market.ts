import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/market";

type Result<T> = { url: string; data?: T; loading: boolean; error?: string };
export function useMarket<T>(url: string, parse: (data: unknown) => T) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result<T>>({ url, loading: true });
  useEffect(() => {
    const controller = new AbortController();
    setResult((previous) => ({
      url,
      loading: true,
      data: previous.url === url ? previous.data : undefined,
    }));
    void fetchJson(url, parse, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted)
          setResult({ url, data, loading: false });
      },
      (error) => {
        if (controller.signal.aborted) return;
        const message =
          error instanceof Error && error.name === "Error"
            ? error.message
            : "网络连接失败或请求超时，请重试。";
        setResult((previous) => ({
          ...previous,
          loading: false,
          error: message,
        }));
      },
    );
    return () => controller.abort();
  }, [url, parse, attempt]);
  const current: Result<T> =
    result.url === url ? result : { url, loading: true };
  return { ...current, retry: () => setAttempt((n) => n + 1) };
}
