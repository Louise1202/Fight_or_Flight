"use client";

import { useSignal } from "@/lib/useSignal";

export default function NoSignalBar() {
  const signal = useSignal();
  if (signal) return null;
  return (
    <p role="status" className="mb-3 rounded-md bg-yellow-500 px-3 py-2 text-sm font-medium text-black">
      No signal. Keep going, everything is saved on this phone.
    </p>
  );
}
