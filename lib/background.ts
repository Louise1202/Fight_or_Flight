// SERVER-ONLY. Work that must finish but that nobody should wait for
// (emails after a tap). On Vercel, waitUntil keeps the function alive
// until the promise settles after the response has been sent; locally
// the promise simply runs on. Errors are swallowed - callers log their own.
import { waitUntil } from "@vercel/functions";

export function inBackground(work: Promise<unknown> | (() => Promise<unknown>)): void {
  const p = (typeof work === "function" ? work() : work).catch(() => {});
  try {
    waitUntil(p);
  } catch {
    // Not running on Vercel: the promise continues on its own.
  }
}
