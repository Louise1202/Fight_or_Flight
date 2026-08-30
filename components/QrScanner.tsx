"use client";

import { useEffect, useRef } from "react";

export default function QrScanner({
  onDecode,
  active,
  onError,
}: {
  onDecode: (text: string) => void;
  active: boolean;
  onError?: (message: string) => void;
}) {
  const containerId = "qr-reader";
  const scannerRef = useRef<any>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    import("html5-qrcode")
      .then(({ Html5Qrcode }) => {
        if (cancelled) return;
        try {
          const scanner = new Html5Qrcode(containerId);
          scannerRef.current = scanner;

          scanner
            .start(
              { facingMode: "environment" },
              { fps: 10, qrbox: { width: 240, height: 240 } },
              (decodedText: string) => {
                // Never let a problem in the app's own decode handling
                // escape back into html5-qrcode's internal scanning loop -
                // that's an unusual place for React to catch an error,
                // and on some browsers it can crash the whole screen
                // instead of just this component.
                try {
                  onDecode(decodedText.trim());
                } catch (err) {
                  console.error("Scan handling failed", err);
                  onError?.("Something went wrong reading that scan. Try again.");
                }
              },
              () => {
                // ignore per-frame decode misses
              }
            )
            .catch((err: unknown) => {
              console.error("Camera failed to start", err);
              onError?.(
                "Couldn't start the camera on this device. Use manual entry below instead."
              );
            });
        } catch (err) {
          console.error("Failed to initialize QR scanner", err);
          onError?.(
            "This device doesn't support the camera scanner. Use manual entry below instead."
          );
        }
      })
      .catch((err) => {
        console.error("Failed to load QR scanner library", err);
        onError?.("Couldn't load the scanner. Use manual entry below instead.");
      });

    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      if (scanner) {
        try {
          scanner.stop().then(() => scanner.clear()).catch(() => {});
        } catch {
          // ignore cleanup errors - nothing more to do
        }
      }
    };
  }, [active, onDecode, onError]);

  return (
    <div
      id={containerId}
      className="mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-lg border border-fofGunmetal"
    />
  );
}
