// Adapted from one-ip's validated theme storage, without the Jotai dependency.
export type Theme = "light" | "dark" | "system";
const storageKey = "gold-price-theme";
const listeners = new Set<() => void>();

function readTheme(): Theme {
  try {
    const value = localStorage.getItem(storageKey);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

let theme = readTheme();

export function getTheme() {
  return theme;
}

export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function updateTheme(next: Theme) {
  theme = next;
  try {
    localStorage.setItem(storageKey, next);
  } catch {
    /* Storage may be disabled. */
  }
  listeners.forEach((listener) => listener());
}

window.addEventListener("storage", (event) => {
  if (event.key === storageKey || event.key === null) {
    theme = readTheme();
    listeners.forEach((listener) => listener());
  }
});
