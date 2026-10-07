import type { Metadata, Viewport } from "next";
import { Staatliches, Barlow_Semi_Condensed, IBM_Plex_Mono, Permanent_Marker } from "next/font/google";
import "./globals.css";
import { getActiveEvent } from "@/lib/activeEvent";

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

// Permanent Marker: rough, hand-scratched look - closer to the patch's
// actual distressed lettering than Staatliches. Used sparingly (just the
// "CONGRATULATIONS!" arc on a finished team's page), not as a general
// display face.
const permanentMarker = Permanent_Marker({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-marker",
});

export const metadata: Metadata = {
  title: "Race Timing",
  description: "Live race timing for The Box team fitness events",
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
};

// viewportFit: "cover" is what makes env(safe-area-inset-top) below
// actually return the iPhone notch's real height - without it, iOS
// doesn't render edge-to-edge and the inset just evaluates to 0.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The page background behind every screen follows the current event's
  // colours (Survivor blue), so no Fight or Flight red shows at the edges.
  // Each page still sets its own event's brand on its <main>.
  const event = await getActiveEvent().catch(() => null);
  return (
    <html
      lang="en"
      className={`${staatliches.variable} ${barlow.variable} ${plexMono.variable} ${permanentMarker.variable}`}
    >
      <body
        data-brand={event?.theme ?? "fof"}
        className="ground min-h-screen bg-fofBlack text-fofPaper font-body antialiased pt-[env(safe-area-inset-top)]"
      >
        {children}
      </body>
    </html>
  );
}
