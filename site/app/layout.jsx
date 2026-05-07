import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-ui",
  display: "swap"
});

export const metadata = {
  title: "SendLens · A senior outbound analyst inside your AI tool",
  description:
    "SendLens turns Instantly into clear, evidence-backed answers about which campaigns to scale, kill, or rewrite, which copy is pulling replies, and what to test next."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={geist.variable}>
      <body>{children}</body>
    </html>
  );
}
