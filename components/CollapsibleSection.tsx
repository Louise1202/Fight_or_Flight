"use client";

import { useState } from "react";

export default function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="mb-10 rounded border border-fofCharcoal p-4">
      <div className="mb-3 flex items-center justify-between border-t-2 border-fofRed pt-4">
        <h2 className="font-display text-lg tracking-wide">{title}</h2>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Collapse" : "Expand"}
          className="rounded border border-fofGunmetal px-2 py-1 text-xs text-fofGunmetal hover:border-fofRed hover:text-fofRed"
        >
          {open ? "✕" : "+"}
        </button>
      </div>
      {open && children}
    </section>
  );
}
