import type { Metadata } from "next";
import { SolanaProviders } from "@/components/providers/SolanaProviders";
import { ShadowBidProvider } from "@/components/shadow-bid/ShadowBidContext";
import { IBM_Plex_Mono, Syne } from "next/font/google";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";

const syne = Syne({
  subsets: ["latin"],
  variable: "--font-syne",
  display: "swap",
});

const ibmMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ShadowBid · Sealed-bid auctions on Solana",
  description:
    "Sealed-bid auctions with Arcium MPC: encrypted bids on-chain, authority-controlled winner reveal.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${syne.variable} ${ibmMono.variable} font-sans relative z-[2]`}
        suppressHydrationWarning
      >
        <SolanaProviders>
          <ShadowBidProvider>{children}</ShadowBidProvider>
        </SolanaProviders>
      </body>
    </html>
  );
}
