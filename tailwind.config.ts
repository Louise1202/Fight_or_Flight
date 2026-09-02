import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Same token names as before - values retuned for the patch-native
        // palette (warmer near-black, brighter red for direct sunlight).
        fofRed: "#E8262D",      // was #D71920 - ~8% brighter, survives daylight
        fofBlack: "#0E0D0C",    // was #151515 - warm near-black, reads leather
        fofPaper: "#F4F1EA",    // was #F2F2F2 - warm bone, not clinical white
        fofGunmetal: "#7A756C", // was #5A5F63 - lightened, now passes AA at 13px
        fofCharcoal: "#2A2724", // was #333333 - warm rule/stitch colour
        // Additions (nothing renamed): second surface level + sunk footer.
        fofPanel: "#191713",
        fofSunk: "#0B0A09",
        fofRule: "#3A3630",
      },
      fontFamily: {
        display: ["var(--font-display)"],
        body: ["var(--font-body)"],
        mono: ["var(--font-mono)"],
        marker: ["var(--font-marker)"],
      },
    },
  },
  plugins: [],
};
export default config;
