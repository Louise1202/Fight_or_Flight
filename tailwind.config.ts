import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        fofRed: "#D71920",
        fofBlack: "#151515",
        fofPaper: "#F2F2F2",
        fofGunmetal: "#5A5F63",
        fofCharcoal: "#333333",
      },
      fontFamily: {
        display: ["var(--font-display)"],
        body: ["var(--font-body)"],
      },
    },
  },
  plugins: [],
};
export default config;
