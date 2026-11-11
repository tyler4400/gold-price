import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function PriceAlertButton() {
  const [notice, setNotice] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function remind() {
    setNotice(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(false), 4000);
  }

  return (
    <>
      <Button onClick={remind}>
        <Bell aria-hidden="true" />
        到价提醒
      </Button>
      <div
        role="status"
        aria-live="polite"
        className={notice ? "notice-toast" : "sr-only"}
      >
        {notice ? "即将上线" : ""}
      </div>
    </>
  );
}
