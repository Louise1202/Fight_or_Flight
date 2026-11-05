"use client";

// Asks the phone to keep the judge pages (public/sw.js). Production only:
// the dev server's files change on every edit. If the browser can't do
// this, the app works as before and simply needs signal to open a page.

async function worker(): Promise<ServiceWorker | null> {
  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return null;
  await navigator.serviceWorker.register("/sw.js");
  const ready = await navigator.serviceWorker.ready;
  return ready.active;
}

export function saveJudgePages(paths: string[]) {
  worker()
    .then((sw) => sw?.postMessage({ type: "save-pages", paths }))
    .catch(() => {});
}

/** On log out, so the next person on this phone can't open them. */
export async function forgetJudgePages() {
  try {
    if (!("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    reg?.active?.postMessage({ type: "forget-pages" });
  } catch {
    // Nothing saved, or storage unavailable.
  }
}
