import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Same token names as before, but each now points at a CSS variable
        // (defined in globals.css) instead of a fixed hex value. That lets a
        // scoped [data-theme="light"] override flip every one of these at
        // once, without touching a single className anywhere in the app.
        fofRed: "var(--fof-red)",
        fofBlack: "var(--fof-black)",
        fofPaper: "var(--fof-paper)",
        fofGunmetal: "var(--fof-gunmetal)",
        fofCharcoal: "var(--fof-charcoal)",
        fofPanel: "var(--fof-panel)",
        fofSunk: "var(--fof-sunk)",
        fofRule: "var(--fof-rule)",
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
