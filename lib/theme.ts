"use client";

import { useSyncExternalStore } from "react";

/**
 * Light / dark theme. The choice lives in localStorage and on
 * <html data-theme>; with no choice saved, the device setting decides.
 * THEME_SCRIPT runs before the page paints, so there is no flash.
 */

export type Theme = "light" | "dark";
const KEY = "theme";
const BG: Record<Theme, string> = { light: "#ffffff", dark: "#0b0b0c" };

export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${KEY}");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}document.documentElement.dataset.theme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.content=t==="light"?"${BG.light}":"${BG.dark}"}catch(e){document.documentElement.dataset.theme="dark"}})();`;

function current(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BG[theme]);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode: the choice lasts until the page closes */
  }
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, current, () => "dark");
}
