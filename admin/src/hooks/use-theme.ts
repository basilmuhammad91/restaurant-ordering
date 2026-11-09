import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";
const KEY = "restoflux_theme";

const systemDark = () => matchMedia("(prefers-color-scheme: dark)").matches;

function apply(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && systemDark()));
}

function read(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

/** Light / dark / follow-the-OS, remembered across visits (the inline script in index.html applies it before first paint). */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(read);

  const setTheme = useCallback((t: Theme) => {
    try {
      if (t === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, t);
    } catch {
      /* ignore */
    }
    setThemeState(t);
    apply(t);
  }, []);

  // follow OS changes while in "system" mode
  useEffect(() => {
    if (theme !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  return { theme, setTheme };
}
