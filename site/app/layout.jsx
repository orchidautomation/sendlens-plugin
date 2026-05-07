import { Inter, JetBrains_Mono, Fraunces } from "next/font/google";
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

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["italic"],
  variable: "--font-serif",
  display: "swap"
});

export const metadata = {
  title: "SendLens · Agentic intelligence for outbound",
  description:
    "SendLens turns your Instantly account into something you can talk to. Ask in plain English inside Claude or Codex and get a clear, evidence-backed answer about your actual campaigns, senders, and replies."
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${mono.variable} ${fraunces.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
