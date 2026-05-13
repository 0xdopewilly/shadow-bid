"use client";

import { AppShell, PageHero } from "@/components/shadow-bid/AppShell";
import { AuctionCard } from "@/components/shadow-bid/AuctionCard";
import { OnChainBidHistory } from "@/components/shadow-bid/OnChainBidHistory";
import { PrivateDashboard } from "@/components/shadow-bid/PrivateDashboard";
import { useShadowBid } from "@/components/shadow-bid/ShadowBidContext";
import { isLocalSolanaRpc } from "@/lib/solana/cluster";
import { Coins, Hash, Radio, Sparkles, Wallet } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

function truncateMid(s: string, a = 6, b = 6) {
  if (s.length <= a + b + 1) return s;
  return `${s.slice(0, a)}…${s.slice(-b)}`;
}

export function DashboardPage() {
  const {
    walletPk,
    publicKey,
    connected,
    openWalletModal,
    rpcEndpoint,
    rpcReachable,
    solBalance,
    clusterOffset,
    mxePub,
    allAuctions,
    auctionsLoading,
    reclaimRent,
    reportError,
  } = useShadowBid();

  const myAuctions = useMemo(() => {
    if (!walletPk) return [];
    return allAuctions
      .filter((a) => a.authority.toBase58() === walletPk)
      .sort((a, b) => (a.revealed === b.revealed ? 0 : a.revealed ? 1 : -1));
  }, [allAuctions, walletPk]);

  const isLocalLikeRpc = isLocalSolanaRpc(rpcEndpoint);

  return (
    <AppShell>
      <PageHero
        eyebrow="Dashboard"
        title="Your auctions, your bids, your wallet"
        subtitle="Solana is the source of truth: confirmed transactions are authoritative. Plaintext amounts below are cached locally for convenience and can be cleared without affecting chain state."
      />

      {!connected ? (
        <div className="mx-auto mt-10 max-w-2xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-8 text-center">
            <Wallet className="mx-auto h-7 w-7 text-violet-300" />
            <h2 className="mt-3 text-xl font-semibold text-white">
              Connect a wallet to see your dashboard
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Your bid plaintext lives only in your own browser, scoped per wallet.
            </p>
            <button
              type="button"
              onClick={openWalletModal}
              className="mt-5 inline-flex items-center gap-2 rounded-full border border-violet-400/40 bg-gradient-to-r from-violet-600 via-fuchsia-600 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_0_28px_rgba(192,38,211,0.45)]"
            >
              <Wallet className="h-4 w-4" /> Connect wallet
            </button>
          </div>
        </div>
      ) : (
        <div className="mx-auto mt-8 grid w-full max-w-[1400px] gap-6 px-4 pb-12 sm:px-6 lg:grid-cols-[1.4fr_1fr] lg:gap-8 lg:px-8">
          {/* LEFT */}
          <div className="flex flex-col gap-6">
            <OnChainBidHistory />

            <PrivateDashboard
              walletPk={walletPk}
              rpcEndpoint={rpcEndpoint}
              reclaimRent={async (offset) => {
                try {
                  return await reclaimRent(offset);
                } catch (e) {
                  reportError(e);
                  throw e;
                }
              }}
            />

            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Your auctions</h3>
                <Link
                  href="/auctions"
                  className="text-[11px] text-slate-400 hover:text-violet-200"
                >
                  view all auctions →
                </Link>
              </div>
              {rpcReachable === false ? (
                <p className="text-xs text-amber-200/90">
                  Cannot refresh auctions: RPC unreachable at{" "}
                  <code className="text-amber-100/90">{truncateMid(rpcEndpoint, 16, 12)}</code>.
                  {isLocalLikeRpc ? (
                    <>
                      {" "}
                      Restore the validator stack, then reload (for example rerun your local orchestration script).
                    </>
                  ) : (
                    <> Restore connectivity and refresh this page.</>
                  )}
                </p>
              ) : auctionsLoading && myAuctions.length === 0 ? (
                <p className="text-xs text-slate-500">Loading auctions…</p>
              ) : myAuctions.length === 0 ? (
                <div className="space-y-2 text-xs text-slate-500">
                  <p>
                    No auction account found for this wallet on the current cluster. If you had
                    listings before, the chain you&apos;re pointed at may have been{" "}
                    <span className="text-slate-300">reset</span> or migrated to newer PDAs.
                  </p>
                  {isLocalLikeRpc ? (
                    <p className="rounded-lg border border-white/[0.06] bg-black/20 p-2 text-[11px] leading-relaxed text-slate-400">
                      <span className="font-medium text-violet-200/90">Sandbox ledger:</span> restarting a
                      local validator clears prior accounts. Create a listing again from{" "}
                      <Link href="/auctions" className="text-violet-300/90 hover:text-violet-200">
                        Auctions
                      </Link>
                      . Sellers can anchor multiple auctions with distinct PDAs keyed by listing index.
                    </p>
                  ) : (
                    <p>
                      Head to{" "}
                      <Link href="/auctions" className="text-violet-300/90 hover:text-violet-200">
                        Auctions
                      </Link>{" "}
                      to create one — sellers can operate several listings concurrently.
                    </p>
                  )}
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {myAuctions.map((a) => (
                    <AuctionCard key={a.pda.toBase58()} auction={a} isMine />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: connection + cluster */}
          <div className="flex flex-col gap-6">
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5">
              <h3 className="mb-3 text-sm font-semibold text-white">Wallet</h3>
              <dl className="space-y-2 text-xs">
                <Row
                  label="Address"
                  value={
                    publicKey ? (
                      <code className="font-mono text-slate-200">
                        {truncateMid(publicKey.toBase58())}
                      </code>
                    ) : (
                      "—"
                    )
                  }
                />
                <Row
                  label="Balance"
                  value={
                    solBalance != null ? (
                      <span className="font-mono text-violet-200">
                        {solBalance.toFixed(6)} SOL
                      </span>
                    ) : (
                      "—"
                    )
                  }
                />
              </dl>
            </div>

            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5">
              <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-white">
                <Sparkles className="h-3.5 w-3.5 text-violet-300" />
                Cluster
              </h3>
              <dl className="space-y-2 text-xs">
                <Row
                  label="RPC"
                  value={
                    <span
                      className={
                        rpcReachable === true
                          ? "text-emerald-200"
                          : rpcReachable === false
                            ? "text-amber-200"
                            : "text-slate-400"
                      }
                    >
                      {rpcReachable === true
                        ? "connected"
                        : rpcReachable === false
                          ? "offline"
                          : "checking…"}
                    </span>
                  }
                />
                <Row
                  label="Endpoint"
                  value={
                    <code className="break-all font-mono text-[11px] text-slate-300">
                      {rpcEndpoint}
                    </code>
                  }
                />
                <Row label="Cluster offset" value={<span className="text-violet-300/90">{clusterOffset}</span>} />
                <Row
                  label="MXE pubkey"
                  value={
                    <span className="inline-flex items-center gap-1 text-[11px]">
                      <Radio
                        className={`h-3 w-3 ${mxePub ? "text-emerald-300" : "text-slate-500"}`}
                      />
                      {mxePub ? "fetched" : "pending"}
                    </span>
                  }
                />
              </dl>
            </div>

            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-violet-200">
                <Coins className="h-3.5 w-3.5" />
                Tip
              </h3>
              <p className="text-xs text-slate-400">
                Each <code className="text-slate-300">place_bid</code>{" "}
                creates a per-call Arcium computation account. After the bid
                finalizes, hit <span className="text-violet-300/90">Reclaim rent</span>{" "}
                on the bid above to pull the lamports back to your wallet.
              </p>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right text-slate-200">{value}</dd>
    </div>
  );
}
