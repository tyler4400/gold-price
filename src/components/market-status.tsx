import { CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Loading({ children }: { children: string }) {
  return (
    <p role="status" className="status-message">
      <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      {children}
    </p>
  );
}
export function RequestError({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return (
    <div role="alert" className="request-error">
      <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
      <p className="flex-1">{message}</p>
      <Button variant="outline" onClick={retry}>
        <RefreshCw aria-hidden="true" />
        重试
      </Button>
    </div>
  );
}
