import type { Metadata } from "next";
import { Staatliches, Barlow_Semi_Condensed, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Staatliches: condensed poster caps with slightly cut, irregular terminals -
// the calm sibling of the hand-scratched lettering on the patch. Caps only.
const staatliches = Staatliches({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
});

// Barlow Semi Condensed: keeps the condensed rhythm of the display face
// without the roughness. Holds up at 13px on a phone in daylight.
const barlow = Barlow_Semi_Condensed({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
});

// IBM Plex Mono: numerics only - clocks, splits, positions, counts.
// Tabular figures so lists of times stack into columns.
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Fight or Flight — Race Timing",
  description: "Live race timing for the Fight or Flight team event",
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${staatliches.variable} ${barlow.variable} ${plexMono.variable}`}
    >
      <body className="ground min-h-screen bg-fofBlack text-fofPaper font-body antialiased">
        {children}
      </body>
    </html>
  );
}
