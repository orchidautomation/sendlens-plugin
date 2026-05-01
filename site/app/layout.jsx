import { Inter, JetBrains_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap"
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap"
});

const instrument = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap"
});

export const metadata = {
  title: "SendLens — see what lands",
  description:
    "A private plugin that grades your Instantly campaigns from outcomes. See what is working, who is responding, and what to change next."
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${mono.variable} ${instrument.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
