// Adapted from one-ip's system theme subscription and synchronous DOM update.
import { useLayoutEffect, useSyncExternalStore } from "react";
import {
  getTheme,
  subscribeTheme,
  updateTheme,
  type Theme,
} from "@/store/theme";

const query = "(prefers-color-scheme: dark)";
function subscribeSystem(callback: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function applyTheme(resolved: "light" | "dark") {
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.style.colorScheme = resolved;
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribeTheme, getTheme);
  const isDark = useSyncExternalStore(
    subscribeSystem,
    () => window.matchMedia(query).matches,
  );
  const systemTheme = isDark ? "dark" : "light";
  const resolvedTheme = theme === "system" ? systemTheme : theme;
  useLayoutEffect(() => applyTheme(resolvedTheme), [resolvedTheme]);
  const setTheme = (next: Theme) => {
    applyTheme(next === "system" ? systemTheme : next);
    updateTheme(next);
  };
  return { theme, resolvedTheme, setTheme };
}
