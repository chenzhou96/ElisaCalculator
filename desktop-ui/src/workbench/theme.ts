export type Theme = "light" | "dark";
const storageKey = "elisa-calculator.theme";

export function readTheme(): Theme {
  try {
    return window.localStorage.getItem(storageKey) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(storageKey, theme);
  } catch {
    // Switching still works when storage is unavailable.
  }
}
