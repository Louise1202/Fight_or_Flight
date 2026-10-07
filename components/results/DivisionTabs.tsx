"use client";

import { NO_DIVISION } from "@/lib/leaderboard";

export const ALL_TAB = "All";

/**
 * Tabs in a fixed order: Men, Women, Mixed always; Kids and any other
 * division only when a team in it exists; All last.
 */
export function divisionTabs(present: string[]): string[] {
  const base = ["Men", "Women", "Mixed"];
  const extra = present.filter((d) => !base.includes(d));
  extra.sort((a, b) => {
    const rank = (d: string) => (d === "Kids" ? 0 : d === NO_DIVISION ? 2 : 1);
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  return [...base, ...extra, ALL_TAB];
}

export default function DivisionTabs({
  tabs,
  active,
  onChange,
  counts,
}: {
  tabs: string[];
  active: string;
  onChange: (tab: string) => void;
  counts?: Record<string, number>;
}) {
  return (
    <div role="tablist" aria-label="Division" className="mb-6 flex flex-wrap justify-center gap-2">
      {tabs.map((t) => {
        const selected = t === active;
        const n = counts?.[t];
        return (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(t)}
            className={`min-h-[44px] rounded-full border px-4 py-2 font-display text-lg tracking-wide transition-colors lg:px-6 lg:text-2xl ${
              selected
                ? "border-fofRed bg-fofRed text-white"
                : "border-fofCharcoal text-fofGunmetal hover:border-fofRed hover:text-fofPaper"
            }`}
          >
            {t}
            {n != null && <span className="nums ml-2 text-sm opacity-80">{n}</span>}
          </button>
        );
      })}
    </div>
  );
}
