// Adapted from tyler4400/one-ip (upstream zhihui-hu/one-ip), AGPL-3.0-only.
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";
import { Monitor, Moon, Sun } from "lucide-react";
import { flushSync } from "react-dom";

type ThemeTransition = {
  ready: Promise<void>;
  finished: Promise<void>;
  skipTransition: () => void;
};
type TransitionDocument = Document & {
  startViewTransition?: (update: () => void) => ThemeTransition;
};

export function ThemeToggleButton({
  className,
  label,
}: {
  className?: string;
  label?: string;
}) {
  const { theme, setTheme } = useTheme();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const transitionRef = useRef<ThemeTransition | null>(null);
  const animationRef = useRef<Animation | null>(null);
  const nextTheme =
    theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  const names = { system: "跟随系统", light: "浅色", dark: "深色" };
  const buttonLabel =
    label ?? `当前：${names[theme]}；切换为${names[nextTheme]}`;

  useEffect(
    () => () => {
      animationRef.current?.cancel();
      transitionRef.current?.skipTransition();
      busy.current = false;
      setPending(false);
    },
    [setPending],
  );

  async function handleToggle(event: MouseEvent<HTMLButtonElement>) {
    if (busy.current) return;
    const updateTheme = () => flushSync(() => setTheme(nextTheme));
    const transitionDocument = document as TransitionDocument;
    if (
      !transitionDocument.startViewTransition ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      updateTheme();
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    // Keyboard activation expands from the button center; pointer activation uses the exact click.
    const x = event.detail === 0 ? rect.left + rect.width / 2 : event.clientX;
    const y = event.detail === 0 ? rect.top + rect.height / 2 : event.clientY;
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );
    busy.current = true;
    setPending(true);
    try {
      const transition = transitionDocument.startViewTransition(updateTheme);
      transitionRef.current = transition;
      await transition.ready;
      // Reveal the NEW theme outwards in both directions, never shrink the old theme.
      const animation = document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${radius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 580,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          fill: "both",
          pseudoElement: "::view-transition-new(root)",
        },
      );
      animationRef.current = animation;
      await animation.finished;
      await transition.finished;
    } catch {
      transitionRef.current?.skipTransition();
      // Unsupported pseudo-element animations still complete the theme change.
      updateTheme();
    } finally {
      animationRef.current = null;
      transitionRef.current = null;
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <Button
      type="button"
      aria-label={buttonLabel}
      title={buttonLabel}
      disabled={pending}
      aria-busy={pending}
      className={cn("shrink-0 rounded-lg shadow-none", className)}
      onClick={(event) => void handleToggle(event)}
      size="icon-sm"
      variant="ghost"
    >
      {theme === "system" ? (
        <Monitor aria-hidden="true" />
      ) : theme === "dark" ? (
        <Moon aria-hidden="true" />
      ) : (
        <Sun aria-hidden="true" />
      )}
    </Button>
  );
}
