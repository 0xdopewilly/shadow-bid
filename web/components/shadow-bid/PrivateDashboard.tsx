"use client";

import {
  clearUserBids,
  listUserBids,
  markBidRentClaimed,
  type StoredBid,
} from "@/lib/shadow-bid/userBids";
import { lamportsToSolDisplay } from "@/lib/shadow-bid/lamportsDisplay";
import { isLocalSolanaRpc } from "@/lib/solana/cluster";
import {
  Coins,
  Eye,
  EyeOff,
  ExternalLink,
  Lock,
  Trash2,
  Wallet as WalletIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

interface Props {
  walletPk: string | null;
  rpcEndpoint: string;
  /** Optional: reclaim rent after a finalized computation; returns transaction signature. */
  reclaimRent?: (computationOffset: string) => Promise<string>;
  className?: string;
}

function explorerUrl(rpcEndpoint: string, sig: string): string {
  if (/devnet/i.test(rpcEndpoint))
    return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
  if (isLocalSolanaRpc(rpcEndpoint))
    return `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(
      rpcEndpoint
    )}`;
  return `https://explorer.solana.com/tx/${sig}`;
}

function maskedAmount(): string {
  const len = 6 + Math.floor(Math.random() * 4);
  return Array.from({ length: len }, () => "•").join("");
}

/**
 * Local-only ledger of the user's own sealed bids — never leaves the browser.
 * Plaintext is what the user typed at submit time; this panel just remembers
 * and lets them re-reveal locally + reclaim rent on finalized computations.
 */
export function PrivateDashboard({
  walletPk,
  rpcEndpoint,
  reclaimRent,
  className = "",
}: Props) {
  const [bids, setBids] = useState<StoredBid[]>([]);
  const [revealAll, setRevealAll] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!walletPk) {
      setBids([]);
      return;
    }
    setBids(listUserBids(walletPk));
  }, [walletPk]);

  useEffect(() => {
    refresh();
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return refresh();
      if (e.key.startsWith("shadowbid:userbids:")) refresh();
    };
    window.addEventListener("storage", onStorage);
    const t = setInterval(refresh, 5000);
    return () => {
      window.removeEventListener("storage", onStorage);
      clearInterval(t);
    };
  }, [refresh]);

  const total = useMemo(() => {
    let sum = BigInt(0);
    for (const b of bids) {
      try {
        sum += BigInt(b.lamports);
      } catch {
        /* ignore */
      }
    }
    return sum;
  }, [bids]);

  if (!walletPk) {
    return (
      <div
        className={`glass-panel rounded-2xl border border-white/10 p-5 text-sm text-slate-500 ${className}`}
      >
        <div className="flex items-center gap-2 text-violet-200/90">
          <WalletIcon className="h-4 w-4" />
          <span className="font-semibold">Private dashboard</span>
        </div>
        <p className="mt-2 text-xs">
          Connect a wallet to see your locally-stored sealed bids.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`glass-panel rounded-2xl border border-white/10 p-5 ${className}`}
    >
      <div className="mb-4 flex items-center gap-2">
        <Lock className="h-4 w-4 text-violet-300" />
        <h3 className="font-semibold text-white">Your private bids</h3>
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-slate-500">
          local-only · never leaves this browser
        </span>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.08] bg-black/35 px-3 py-2 text-xs text-slate-400">
        <Coins className="h-3.5 w-3.5 text-violet-300" />
        Total submitted{" "}
        <span className="font-mono text-violet-200">
          {lamportsToSolDisplay(total.toString())} SOL
        </span>
        <span className="text-slate-600">·</span>
        <span>{bids.length} sealed bid{bids.length === 1 ? "" : "s"}</span>
        <button
          type="button"
          onClick={() => setRevealAll((v) => !v)}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-0.5 text-slate-300 hover:bg-white/10"
        >
          {revealAll ? (
            <>
              <EyeOff className="h-3 w-3" /> Hide
            </>
          ) : (
            <>
              <Eye className="h-3 w-3" /> Reveal locally
            </>
          )}
        </button>
        {bids.length ? (
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  "Clear local-only bid history? On-chain ciphertext is unaffected."
                )
              ) {
                clearUserBids(walletPk);
                refresh();
              }
            }}
            title="Clear local history"
            className="rounded-md border border-white/10 p-1 text-slate-500 hover:text-rose-300"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        ) : null}
      </div>

      {bids.length === 0 ? (
        <p className="text-xs text-slate-500">
          You haven&apos;t placed any sealed bids yet from this browser.
        </p>
      ) : (
        <ul className="max-h-[340px] space-y-2 overflow-y-auto pr-1">
          {bids.map((b) => {
            const id = `${b.auction}-${b.ts}`;
            const reclaimable =
              !!b.computationOffset && !b.rentClaimed && !!reclaimRent;
            return (
              <li
                key={id}
                className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs text-slate-400">
                    {b.auction.slice(0, 6)}…{b.auction.slice(-4)}
                  </span>
                  <span className="font-mono text-base text-violet-100">
                    {revealAll ? `${b.solDisplay} SOL` : maskedAmount()}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                  <span suppressHydrationWarning>
                    {new Date(b.ts).toLocaleString()}
                  </span>
                  {b.txSig ? (
                    <a
                      href={explorerUrl(rpcEndpoint, b.txSig)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-violet-300/80 hover:text-violet-200"
                    >
                      tx <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                  {b.rentClaimed ? (
                    <span className="rounded bg-emerald-500/10 px-1.5 text-emerald-300">
                      rent reclaimed
                    </span>
                  ) : null}
                  {reclaimable ? (
                    <button
                      type="button"
                      disabled={busyId === id}
                      onClick={async () => {
                        if (!b.computationOffset || !reclaimRent) return;
                        setBusyId(id);
                        try {
                          await reclaimRent(b.computationOffset);
                          markBidRentClaimed(walletPk, b.computationOffset);
                          refresh();
                        } catch {
                          /* surfaced upstream via reclaimRent's promise */
                        } finally {
                          setBusyId(null);
                        }
                      }}
                      className="ml-auto rounded-md border border-violet-400/35 bg-violet-500/10 px-2 py-0.5 text-violet-100 hover:bg-violet-500/20 disabled:opacity-50"
                    >
                      {busyId === id ? "Claiming…" : "Reclaim rent"}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
