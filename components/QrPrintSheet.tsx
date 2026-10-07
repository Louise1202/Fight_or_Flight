"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";

type Team = { id: string; team_name: string; wave?: number | null };

export default function QrPrintSheet({ teams, eventTitle }: { teams: Team[]; eventTitle?: string }) {
  const [dataUrls, setDataUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    async function generate() {
      const entries = await Promise.all(
        teams.map(async (t) => {
          const url = await QRCode.toDataURL(t.id, {
            width: 320,
            margin: 1,
            color: { dark: "#000000", light: "#ffffff" },
          });
          return [t.id, url] as const;
        })
      );
      if (!cancelled) setDataUrls(Object.fromEntries(entries));
    }
    generate();
    return () => {
      cancelled = true;
    };
  }, [teams]);

  const allReady = teams.every((t) => dataUrls[t.id]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 print:px-0 print:py-0">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <Link
            href="/admin"
            className="tap-target mb-3 inline-flex items-center gap-1 rounded-md border border-fofGunmetal px-3 py-1.5 text-sm text-fofPaper hover:border-fofRed hover:text-fofRed"
          >
            &larr; Back to admin
          </Link>
          <h1 className="font-display text-2xl">Team QR codes</h1>
          {eventTitle && <p className="text-sm text-fofPaper">{eventTitle}</p>}
          <p className="text-sm text-fofGunmetal">
            {teams.length === 0
              ? "No teams yet."
              : `${teams.length} teams - each code just holds the Team ID (e.g. ${teams[0]?.id}), nothing else.`}
          </p>
        </div>
        <button
          onClick={() => window.print()}
          disabled={!allReady || teams.length === 0}
          className="tap-target rounded btn-stamped px-6 font-display disabled:opacity-50"
        >
          {allReady ? "Print" : "Generating..."}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 print:grid-cols-3 print:gap-2">
        {teams.map((t) => (
          <div
            key={t.id}
            className="flex flex-col items-center rounded border border-fofCharcoal bg-white p-3 text-center print:break-inside-avoid print:border-black"
          >
            {dataUrls[t.id] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={dataUrls[t.id]} alt={`QR code for ${t.id}`} className="w-full" />
            ) : (
              <div className="aspect-square w-full animate-pulse bg-gray-200" />
            )}
            <p className="mt-2 break-words font-display text-sm text-black">{t.team_name}</p>
            <p className="font-mono text-xs text-gray-600">
              {t.id}
              {t.wave != null ? ` · Heat ${t.wave}` : ""}
            </p>
          </div>
        ))}
      </div>
    </main>
  );
}
