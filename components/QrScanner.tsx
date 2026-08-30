"use client";

import { useEffect, useRef } from "react";

export default function QrScanner({
  onDecode,
  active,
}: {
  onDecode: (text: string) => void;
  active: boolean;
}) {
  const containerId = "qr-reader";
  const scannerRef = useRef<any>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    import("html5-qrcode").then(({ Html5Qrcode }) => {
      if (cancelled) return;
      const scanner = new Html5Qrcode(containerId);
      scannerRef.current = scanner;

      scanner
        .start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decodedText: string) => {
            onDecode(decodedText.trim());
          },
          () => {
            // ignore per-frame decode misses
          }
        )
        .catch((err: unknown) => {
          console.error("Camera failed to start", err);
        });
    });

    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      if (scanner) {
        scanner.stop().then(() => scanner.clear()).catch(() => {});
      }
    };
  }, [active, onDecode]);

  return (
    <div
      id={containerId}
      className="mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-lg border border-fofGunmetal"
    />
  );
}
