"use client";

import { fetchUserBidSignatures, type OnChainBidTx } from "@/lib/shadow-bid/flows";
import { useShadowBid } from "@/components/shadow-bid/ShadowBidContext";
import { isLocalSolanaRpc } from "@/lib/solana/cluster";
import { useConnection } from "@solana/wallet-adapter-react";
import { ExternalLink, Loader2, Lock, RefreshCw, Shield } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

function shortPk(b58: string, a = 4, b = 4) {
  if (b58.length <= a + b + 1) return b58;
  return `${b58.slice(0, a)}…${b58.slice(-b)}`;
}

function timeAgo(unixSec: number | null): string {
  if (!unixSec) return "—";
  const s = Math.floor(Date.now() / 1000) - unixSec;
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

function explorerTxUrl(rpcEndpoint: string, sig: string): string {
  if (/devnet/i.test(rpcEndpoint))
    return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
  if (isLocalSolanaRpc(rpcEndpoint))
    return `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(rpcEndpoint)}`;
  return `https://explorer.solana.com/tx/${sig}`;
}

export function OnChainBidHistory() {
  const { connection } = useConnection();
  const { program, publicKey, walletPk, rpcEndpoint, rpcReachable } =
    useShadowBid();
  const [rows, setRows] = useState<OnChainBidTx[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!program || !publicKey || rpcReachable !== true) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchUserBidSignatures(connection, program, publicKey, 50);
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch tx history");
    } finally {
      setLoading(false);
    }
  }, [program, publicKey, connection, rpcReachable]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!walletPk) return null;

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 backdrop-blur-md">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/20 text-violet-200">
            <Shield className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">
              On-chain bid history
            </h3>
            <p className="text-[10px] uppercase tracking-widest text-slate-500">
              Pulled from Solana · sealed amounts by design
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
          {error}
        </p>
      ) : null}

      {loading && rows.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-sm text-slate-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Scanning Solana for your bid txs…
        </div>
      ) : rows.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm text-slate-500">
          No <code className="text-slate-400">place_bid</code> txs from this wallet
          yet — open an auction and submit one.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.signature}
              className={`rounded-xl border p-3 text-sm ${
                row.err
                  ? "border-rose-500/30 bg-rose-500/5"
                  : "border-white/[0.06] bg-white/[0.02]"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Lock className="h-3.5 w-3.5 text-violet-300" />
                  <span className="font-mono text-xs text-slate-200">
                    {shortPk(row.signature, 6, 6)}
                  </span>
                  {row.err ? (
                    <span className="rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-rose-200">
                      failed
                    </span>
                  ) : null}
                </div>
                <a
                  href={explorerTxUrl(rpcEndpoint, row.signature)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-violet-300 hover:text-violet-200"
                >
                  explorer <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                <span>amount: <span className="text-violet-300/90">sealed</span></span>
                <span>·</span>
                <span suppressHydrationWarning>{timeAgo(row.blockTime)}</span>
                <span>·</span>
                <span>slot {row.slot}</span>
                {row.auction ? (
                  <>
                    <span>·</span>
                    <Link
                      href={`/auctions/${row.auction.toBase58()}`}
                      className="inline-flex items-center gap-1 text-slate-300 hover:text-violet-200"
                    >
                      auction {shortPk(row.auction.toBase58())}
                    </Link>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[11px] text-slate-500">
        Bid <strong>amounts</strong> are encrypted on-chain — that&apos;s the
        sealed-bid guarantee. The chain proves you bid; only the MXE knows by how
        much (and only your own browser knows the plaintext you submitted).
      </p>
    </div>
  );
}
