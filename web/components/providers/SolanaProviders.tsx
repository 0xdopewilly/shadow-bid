"use client";

import { installBufferPolyfill } from "@/lib/solana/polyfills";
import { getRpcEndpoint } from "@/lib/solana/env";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { type ReactNode, useMemo } from "react";

installBufferPolyfill();

export function SolanaProviders({ children }: { children: ReactNode }) {
  const endpoint = useMemo(() => getRpcEndpoint(), []);
  const connectionConfig = useMemo(
    () =>
      ({
        commitment: "confirmed",
        confirmTransactionInitialTimeout: 120_000,
      }) as const,
    []
  );
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint} config={connectionConfig}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
