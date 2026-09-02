import Image from "next/image";

const SWATCHES = [
  { token: "fofBlack", hex: "#0E0D0C", note: "Base. Warm near-black - reads leather, not OLED." },
  { token: "fofPanel", hex: "#191713", note: "Panel / row fill. Only two surface levels." },
  { token: "fofRed", hex: "#E8262D", note: "Live state, primary action, the clock. Never body copy." },
  { token: "fofPaper", hex: "#F4F1EA", note: "Bone. All primary text." },
  { token: "fofGunmetal", hex: "#7A756C", note: "Secondary text, eyebrow labels." },
  { token: "fofCharcoal", hex: "#2A2724", note: "Rules and stitch lines." },
];

const TYPE = [
  { name: "font-display - Staatliches", sample: "BRAVO COMPANY", cls: "font-display text-5xl tracking-wide", note: "Headings, team names, buttons. CAPS only, never below 19px." },
  { name: "font-body - Barlow Semi Condensed", sample: "Station 04 - Sandbag Carry · Judge: M. Okafor", cls: "font-body text-xl", note: "Labels, dense info, everything else. Min 13px." },
  { name: "font-mono - IBM Plex Mono", sample: "00:04:12.8", cls: "nums text-3xl font-semibold", note: "Every time, split, position and count. tabular-nums." },
];

export default function StyleGuidePage() {
  return (
    <main className="ground min-h-screen px-6 py-10 sm:px-10">
      <header className="mx-auto flex max-w-4xl items-center gap-4 border-b border-fofCharcoal pb-6">
        <Image src="/logo.png" alt="Fight or Flight" width={96} height={96} className="rounded-full" />
        <div>
          <h1 className="font-display text-4xl tracking-wide">VISUAL SYSTEM</h1>
          <p className="nums mt-1 text-[11px] tracking-[2px] text-fofGunmetal">
            GROUND · TYPE · COLOUR
          </p>
        </div>
      </header>

      <section className="mx-auto mt-10 max-w-4xl">
        <h2 className="nums text-[11px] tracking-[2px] text-fofGunmetal">01 - PALETTE</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SWATCHES.map((s) => (
            <div key={s.token} className="border border-fofCharcoal bg-fofPanel p-4">
              <div className="h-14 border border-fofCharcoal" style={{ backgroundColor: s.hex }} />
              <p className="nums mt-3 text-xs text-fofPaper">
                {s.token} <span className="text-fofGunmetal">{s.hex}</span>
              </p>
              <p className="mt-1 text-sm leading-snug text-fofGunmetal">{s.note}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-10 max-w-4xl">
        <h2 className="nums text-[11px] tracking-[2px] text-fofGunmetal">02 - TYPE</h2>
        <div className="mt-4 divide-y divide-fofCharcoal border border-fofCharcoal bg-fofPanel">
          {TYPE.map((t) => (
            <div key={t.name} className="p-5">
              <p className="nums text-[11px] tracking-[2px] text-fofGunmetal">{t.name}</p>
              <p className={`mt-2 text-fofPaper ${t.cls}`}>{t.sample}</p>
              <p className="mt-2 text-sm text-fofGunmetal">{t.note}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-10 max-w-4xl">
        <h2 className="nums text-[11px] tracking-[2px] text-fofGunmetal">03 - COMPONENTS</h2>
        <div className="mt-4 space-y-3 border border-fofCharcoal bg-fofPanel p-5">
          <button className="tap-target w-full btn-stamped font-display text-3xl tracking-[3px] text-fofBlack">
            CONFIRM
          </button>
          <div className="grid grid-cols-2 gap-3">
            <button className="tap-target border border-fofRule font-display text-lg tracking-wide text-fofPaper">
              NO REP
            </button>
            <button className="tap-target border border-fofRule font-display text-lg tracking-wide text-fofPaper">
              PENALTY +0:30
            </button>
          </div>
          <div className="stitch pt-4">
            {[
              { no: "03", station: "Rope Ascent", time: "03:48" },
              { no: "02", station: "Sled Push 40m", time: "02:11" },
              { no: "01", station: "Ruck Run 1.6km", time: "11:04" },
            ].map((r) => (
              <div key={r.no} className="flex items-baseline justify-between border-b border-fofCharcoal/60 py-3">
                <span className="flex items-baseline gap-3">
                  <span className="nums w-6 text-xs text-fofGunmetal">{r.no}</span>
                  <span className="text-lg text-fofPaper">{r.station}</span>
                </span>
                <span className="nums text-lg font-medium text-fofPaper">{r.time}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="stitch mx-auto mt-10 flex max-w-4xl items-center justify-center gap-5 pt-6">
        <Image src="/partners/the-box.png" alt="The Box Fitness Center" width={180} height={69} className="h-[66px] w-auto opacity-90" />
        <span className="h-8 w-px bg-fofCharcoal" />
        <Image src="/partners/mission-to-move.png" alt="Mission to Move" width={180} height={75} className="h-[72px] w-auto opacity-90" />
      </footer>
    </main>
  );
}
