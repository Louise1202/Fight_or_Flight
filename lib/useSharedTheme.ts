"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type AppTheme = "dark" | "light";

/**
 * Starts from whatever the server rendered (so there's no flash of the
 * wrong theme on load), then stays live-synced to app_settings via
 * Realtime - the moment the admin flips the toggle, every judge's phone
 * that has this open updates within a second or two, with no refresh.
 */
export function useSharedTheme(initial: AppTheme): AppTheme {
  const [theme, setTheme] = useState<AppTheme>(initial);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("app-settings-theme")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_settings" },
        (payload) => {
          const next = (payload.new as any)?.theme;
          if (next === "dark" || next === "light") setTheme(next);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return theme;
}
