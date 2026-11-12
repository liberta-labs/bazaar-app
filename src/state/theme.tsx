/**
 * Light and dark mode. The user picks System, Light or Dark in the header; System follows the
 * device and changes with it. The choice is kept per browser. index.html applies it before the first
 * paint, so the page never flashes the other theme; this provider keeps it current and tells the
 * wallet window (AppKit) and the chart, which can't read CSS variables by themselves.
 */
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { appKit } from "./appkit";

export type ThemePref = "system" | "light" | "dark";
export type Theme = "light" | "dark";

/** Must match the key index.html reads before the app loads. */
export const THEME_KEY = "bazaar.theme";

const media = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null);

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

interface ThemeState {
  readonly pref: ThemePref;
  readonly theme: Theme;
  readonly setPref: (p: ThemePref) => void;
  /** System, then Light, then Dark. */
  readonly cycle: () => void;
}

const ThemeCtx = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readPref);
  const [systemLight, setSystemLight] = useState(() => media()?.matches ?? false);

  useEffect(() => {
    const m = media();
    if (!m) return;
    const on = (e: MediaQueryListEvent) => setSystemLight(e.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);

  const theme: Theme = pref === "system" ? (systemLight ? "light" : "dark") : pref;
  // Set before the children render, so components that read CSS variables (the chart) see this theme's.
  if (typeof document !== "undefined") document.documentElement.dataset.theme = theme;

  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#f5f5f2" : "#0a0a0a");
    appKit.setThemeMode(theme);
    // The wallet window draws its accent as text too ("QR CODE" tags), so on white it takes the darker amber.
    appKit.setThemeVariables({
      "--w3m-accent": theme === "light" ? "#7a5900" : "#f5c518",
      "--w3m-color-mix": theme === "light" ? "#ffffff" : "#0a0a0a",
      "--w3m-color-mix-strength": theme === "light" ? 0 : 30,
    });
  }, [theme]);

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    try {
      if (p === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, p);
    } catch {
      /* storage blocked: the choice lasts until the page reloads */
    }
  }, []);

  const cycle = useCallback(() => setPref(pref === "system" ? "light" : pref === "light" ? "dark" : "system"), [pref, setPref]);
  const value = useMemo(() => ({ pref, theme, setPref, cycle }), [pref, theme, setPref, cycle]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): ThemeState {
  const v = useContext(ThemeCtx);
  if (!v) throw new Error("useTheme outside ThemeProvider");
  return v;
}

/** The current value of CSS custom properties, re-read when the theme changes. */
export function useCssVars<K extends string>(names: readonly K[]): Record<K, string> {
  const { theme } = useTheme();
  return useMemo(() => {
    const cs = getComputedStyle(document.documentElement);
    return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(`--${n}`).trim()])) as Record<K, string>;
    // The names are fixed per caller; the theme is what changes them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);
}
