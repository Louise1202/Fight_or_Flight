// Fires when a judge's device sees a heat's actual_end get set. No audio
// file needed - the beep is synthesized with the Web Audio API so there's
// nothing extra to load or fail to load.
//
// IMPORTANT PLATFORM LIMIT: navigator.vibrate is an Android Chrome/Firefox
// API. iPhones (Safari, and any PWA built on it) do not support it at
// all - there is no vibration fallback possible on iOS from a web app.
// The sound + on-screen banner are what carry the alert on iPhones.
export function playHeatEndAlert() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (Ctx) {
      const ctx = new Ctx();
      const now = ctx.currentTime;
      // Two short beeps, not one long tone - reads as an alert, not a UI blip.
      [0, 0.25].forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.15, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.2);
      });
    }
  } catch {
    // Audio can fail for all sorts of platform reasons (autoplay policy,
    // no user gesture yet, etc.) - the banner still gets the message
    // across, so this is never worth surfacing as an error.
  }

  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate([200, 100, 200]);
  }
}
