import type { Metadata } from "next";
import { Anton, Barlow } from "next/font/google";
import "./globals.css";

// Anton: heavy, condensed, poster-style display face - matches the bold
// block lettering on the "FIGHT OR FLIGHT" patch.
const anton = Anton({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
});

// Barlow: clean, slightly condensed, reads well on phones outdoors -
// used for all body text, labels, and buttons.
const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
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
    <html lang="en" className={`${anton.variable} ${barlow.variable}`}>
      <body className="min-h-screen bg-fofBlack text-fofPaper font-body antialiased">
        {children}
      </body>
    </html>
  );
}
