"use client";

import Link from "next/link";

/** Top bar on the admin print pages. Hidden when printing. */
export default function PrintBar({ backHref = "/admin" }: { backHref?: string }) {
  return (
    <div className="no-print mb-6 flex flex-wrap items-center gap-3 border-b border-gray-300 pb-4">
      <Link href={backHref} className="inline-flex min-h-[44px] items-center text-sm text-black underline">
        ← Back to admin
      </Link>
      <button
        type="button"
        onClick={() => window.print()}
        className="ml-auto min-h-[44px] rounded-md border border-black px-5 text-sm font-semibold text-black"
      >
        Print
      </button>
      <p className="w-full text-xs text-gray-600">Use your browser&apos;s Print &gt; Save as PDF.</p>
    </div>
  );
}

/** Print rules shared by the admin print pages. */
export function PrintStyles() {
  return (
    <style>{`
      .print-page { background: #fff; color: #000; }
      @media print {
        @page { margin: 14mm; }
        html, body { background: #fff !important; color: #000 !important; }
        body { background-image: none !important; padding-top: 0 !important; }
        .no-print { display: none !important; }
        .print-page { padding: 0 !important; }
        .avoid-break { break-inside: avoid; page-break-inside: avoid; }
      }
    `}</style>
  );
}
