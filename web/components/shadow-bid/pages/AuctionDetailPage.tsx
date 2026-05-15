"use client";

import { AppShell, NavCrumb } from "@/components/shadow-bid/AppShell";
import { CiphertextRain } from "@/components/shadow-bid/CiphertextRain";
import {
  EpochTimer,
  formatCountdown,
  useBiddingCountdown,
} from "@/components/shadow-bid/EpochTimer";
import { RevealModal } from "@/components/shadow-bid/RevealModal";
import { useShadowBid } from "@/components/shadow-bid/ShadowBidContext";
import { SafeRemoteImage } from "@/components/shadow-bid/SafeRemoteImage";
import {
  coerceAnchorU32,
  fetchAuctionAccount,
  listingImageSrc,
  placeBidFlow,
  revealWinnerSubmitTx,
  awaitRevealWinnerFinalizedOrPoll,
  setAuctionDeadlineFlow,
  waitForAuctionBidCountAbove,
} from "@/lib/shadow-bid/flows";
import { lamportsToSolDisplayWithSuffix } from "@/lib/shadow-bid/lamportsDisplay";
import { isLocalSolanaRpc } from "@/lib/solana/cluster";
import {
  addUserBid,
  highestUserBidLamports,
  listUserBidsForAuction,
} from "@/lib/shadow-bid/userBids";
import * as anchor from "@coral-xyz/anchor";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  Check,
  Coins,
  Copy,
  Crown,
  ExternalLink,
  Loader2,
  Lock,
  Play,
  Radio,
  Share2,
  Trophy,
  User as UserIcon,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Snapshot = {
  bidCount: number;
  stateNonce: string;
  authority: PublicKey;
  encryptedStateBytes: Uint8Array;
  revealed: boolean;
  winningBidLamports: string;
  winnerB58: string;
  biddingEndsAt: number;
  title: string;
  description: string;
  imageUri: string;
  fetchedAt: number;
};

const QUICK_SOL_AMTS = ["0.05", "0.25", "1"] as const;

function truncateMid(s: string, a = 5, b = 4) {
  if (s.length <= a + b + 1) return s;
  return `${s.slice(0, a)}…${s.slice(-b)}`;
}

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function explorerTxUrl(rpcEndpoint: string, sig: string): string {
  if (/devnet/i.test(rpcEndpoint))
    return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
  if (isLocalSolanaRpc(rpcEndpoint))
    return `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(rpcEndpoint)}`;
  return `https://explorer.solana.com/tx/${sig}`;
}

function solToLamports(sol: string): bigint {
  const n = Number(sol);
  if (!Number.isFinite(n) || n < 0) throw new Error("Invalid SOL amount");
  return BigInt(Math.round(n * 1e9));
}

function SegmentedBidBar({ filled, total }: { filled: number; total: number }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-2.5 flex-1 rounded-sm transition-all duration-300 ${
            i < filled
              ? "bg-gradient-to-t from-violet-600 to-fuchsia-400 shadow-[0_0_12px_rgba(167,139,250,0.45)]"
              : "bg-white/[0.06]"
          }`}
        />
      ))}
    </div>
  );
}

function DealDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/[0.06] py-2.5 text-sm last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="max-w-[60%] text-right font-medium leading-snug text-slate-100">
        {value}
      </span>
    </div>
  );
}

export function AuctionDetailPage({ auctionPda }: { auctionPda: string }) {
  const {
    program,
    provider,
    publicKey,
    walletPk,
    connected,
    rpcReachable,
    rpcEndpoint,
    mxePub,
    clusterOffset,
    feed,
    pushFeed,
    pushToast,
    reportError,
    copyToClipboard,
    copyFlash,
    refreshAllAuctions,
    openWalletModal,
    solBalance,
  } = useShadowBid();

  const auctionKey = useMemo(() => {
    try {
      return new PublicKey(auctionPda);
    } catch {
      return null;
    }
  }, [auctionPda]);

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [bidInput, setBidInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [revealOpen, setRevealOpen] = useState(false);
  const [revealUiPhase, setRevealUiPhase] = useState<"idle" | "submit" | "mxe">("idle");
  const lastSeenBidCount = useRef<number | null>(null);

  const biddingDeadlineSec =
    auctionKey != null ? snapshot?.biddingEndsAt ?? null : null;
  const countdown = useBiddingCountdown(biddingDeadlineSec);

  const countdownOverride = useMemo(
    () => ({
      remainingMs: countdown.remainingMs,
      endMs: countdown.endMs,
      ended: countdown.ended,
      running: countdown.running,
      locked: countdown.locked,
    }),
    [
      countdown.remainingMs,
      countdown.endMs,
      countdown.ended,
      countdown.running,
      countdown.locked,
    ]
  );

  const refresh = useCallback(async () => {
    if (!program || !auctionKey || rpcReachable === false) {
      setSnapshot(null);
      return;
    }
    const data = await fetchAuctionAccount(program, auctionKey);
    if (data)
      setSnapshot({
        bidCount: data.bidCount,
        stateNonce: data.stateNonce,
        authority: data.authority,
        encryptedStateBytes: data.encryptedStateBytes,
        revealed: data.revealed,
        winningBidLamports: data.winningBid,
        winnerB58: data.winner.toBase58(),
        biddingEndsAt: data.biddingEndsAt,
        title: data.title,
        description: data.description,
        imageUri: data.imageUri,
        fetchedAt: Date.now(),
      });
    else setSnapshot(null);
  }, [program, auctionKey, rpcReachable]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5500);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (revealUiPhase !== "mxe") return;
    const id = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(id);
  }, [revealUiPhase, refresh]);

  useEffect(() => {
    if (!snapshot) {
      lastSeenBidCount.current = null;
      return;
    }
    const prev = lastSeenBidCount.current;
    const next = snapshot.bidCount;
    if (prev != null && next > prev && walletPk) {
      const myBids = listUserBidsForAuction(walletPk, auctionPda);
      if (myBids.length > 0) {
        pushToast({
          kind: "outbid",
          title: "A new sealed bid landed",
          body: "You may have been outbid — amounts stay encrypted until reveal.",
        });
      }
    }
    lastSeenBidCount.current = next;
  }, [snapshot, walletPk, auctionPda, pushToast]);

  useEffect(() => {
    if (!program || !auctionKey || rpcReachable !== true) return;
    const subs: number[] = [];
    try {
      subs.push(
        program.addEventListener(
          "bidPlacedEvent",
          (ev: { auction: PublicKey; bidCount: unknown }) => {
            if (ev.auction.equals(auctionKey)) {
              const n = coerceAnchorU32(ev.bidCount);
              pushFeed(`Anonymous bidder placed sealed bid (#${n}).`, true, 4000);
              void refresh();
            }
          }
        )
      );
      subs.push(
        program.addEventListener(
          "winnerRevealedEvent",
          (ev: {
            auction: PublicKey;
            winner: PublicKey;
            winningBid: anchor.BN;
            totalBids: number;
          }) => {
            if (ev.auction.equals(auctionKey)) {
              const total = coerceAnchorU32(ev.totalBids as unknown);
              pushFeed(
                `Winner revealed · ${truncateMid(ev.winner.toBase58(), 4, 4)} (${total} sealed bids recorded)`,
                true
              );
              pushToast({
                kind: "info",
                title: "Winner revealed",
                body: `${truncateMid(ev.winner.toBase58(), 4, 4)} · ${lamportsToSolDisplayWithSuffix(
                  ev.winningBid.toString()
                )} · ${total} MXE-finalized bids.`,
              });
              setRevealOpen(true);
              void refresh();
              void refreshAllAuctions();
            }
          }
        )
      );
    } catch {
      return;
    }
    return () => {
      for (const id of subs) void program.removeEventListener(id);
    };
  }, [
    program,
    auctionKey,
    pushFeed,
    pushToast,
    refresh,
    refreshAllAuctions,
    rpcReachable,
  ]);

  const isAuthority = useMemo(() => {
    if (!publicKey || !snapshot) return false;
    return publicKey.equals(snapshot.authority);
  }, [publicKey, snapshot]);

  const arciumClusterMisconfigured = useMemo(
    () => clusterOffset === 0 && !isLocalSolanaRpc(rpcEndpoint),
    [clusterOffset, rpcEndpoint]
  );

  const myHighest = useMemo(() => {
    if (!walletPk) return null;
    return highestUserBidLamports(walletPk, auctionPda);
  }, [walletPk, auctionPda, snapshot?.bidCount]);

  const onSubmitBid = useCallback(async () => {
    if (!program || !provider || !publicKey || !auctionKey)
      throw new Error("Wallet + auction required");
    if (!mxePub) throw new Error("MXE key not ready");
    const trimmed = bidInput.trim();
    const lamports = solToLamports(trimmed);
    let countBefore = 0;
    try {
      const cur = await fetchAuctionAccount(program, auctionKey);
      countBefore = cur?.bidCount ?? 0;
    } catch {
      countBefore = snapshot?.bidCount ?? 0;
    }
      setBusy("Sending sealed bid…");
    try {
      const { txSig, computationOffset } = await placeBidFlow(
        program,
        provider,
        clusterOffset,
        publicKey,
        auctionKey,
        lamports,
        mxePub
      );
      addUserBid(publicKey.toBase58(), {
        auction: auctionPda,
        lamports: lamports.toString(),
        solDisplay: trimmed,
        ts: Date.now(),
        txSig,
        computationOffset: computationOffset.toString(10),
      });
      pushFeed(`Sealed bid submitted · tx ${truncateMid(txSig, 6, 6)}`, true);
      pushToast({
        kind: "info",
        title: "Wallet confirmed — waiting for MXC",
        body: "Watching on-chain bid_count until Arcium finalizes…",
      });
      setBidInput("");
      setBusy("Waiting for MXE…");
      const raised = await waitForAuctionBidCountAbove(
        program,
        auctionKey,
        countBefore
      );
      if (raised != null) {
        pushToast({
          kind: "info",
          title: "Sealed bid finalized on-chain",
          body: `MXE bumped bid_count to ${raised}.`,
        });
        pushFeed(`Sealed bid #${raised} confirmed by MXE.`, true);
      } else {
        pushToast({
          kind: "warn",
          title: "bid_count did not increase",
          body:
            "Your transaction may still be settling, or MXC cannot reach this auction. Confirm NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET matches `arcium deploy -o …` (e.g. 456), then check Solana Explorer for your wallet txs.",
        });
      }
      await refresh();
      window.setTimeout(() => void refresh(), 2200);
      window.setTimeout(() => void refresh(), 6500);
    } finally {
      setBusy(null);
    }
  }, [
    program,
    provider,
    publicKey,
    auctionKey,
    auctionPda,
    mxePub,
    clusterOffset,
    bidInput,
    snapshot?.bidCount,
    pushFeed,
    pushToast,
    refresh,
  ]);

  const onSetDeadline = useCallback(
    async (unixSec: number) => {
      if (!program || !publicKey || !auctionKey)
        throw new Error("Wallet + auction required");
      const sig = await setAuctionDeadlineFlow(
        program,
        publicKey,
        auctionKey,
        unixSec
      );
      pushFeed(
        `Deadline locked on-chain · tx ${truncateMid(sig, 6, 6)}`,
        true
      );
      pushToast({
        kind: "info",
        title: "Deadline locked",
        body: "Immutable bidding window written to the program.",
      });
      await refresh();
    },
    [program, publicKey, auctionKey, pushFeed, pushToast, refresh]
  );

  const onReveal = useCallback(async () => {
    if (!program || !provider || !publicKey || !auctionKey)
      throw new Error("Wallet + auction required");

    const latest = await fetchAuctionAccount(program, auctionKey);
    if (!latest) {
      pushToast({
        kind: "warn",
        title: "Auction account unavailable",
        body: "RPC could not load this auction — check your cluster RPC URL.",
      });
      return;
    }
    if (latest.revealed) {
      pushToast({
        kind: "info",
        title: "Already revealed",
        body: "This listing is settled on-chain. Refresh if the UI is stale.",
      });
      void refresh();
      return;
    }
    if (latest.biddingEndsAt > 0) {
      const nowSec = Math.floor(Date.now() / 1000);
      if (nowSec < latest.biddingEndsAt) {
        pushToast({
          kind: "warn",
          title: "Cannot reveal yet",
          body: `On-chain bidding ends ${new Date(latest.biddingEndsAt * 1000).toLocaleString()}. The program rejects reveal_winner before then (DeadlineNotReached).`,
        });
        return;
      }
    }

    setRevealUiPhase("submit");
    setBusy("Queuing reveal…");
    let computationOffset: anchor.BN | null = null;
    try {
      const out = await revealWinnerSubmitTx(
        program,
        provider,
        clusterOffset,
        publicKey,
        auctionKey
      );
      computationOffset = out.computationOffset;
      pushFeed(`reveal_winner tx · ${truncateMid(out.txSig, 6, 6)}`, true);
      pushToast({
        kind: "info",
        title: "Reveal transaction landed",
        body: "Waiting for MXE to finalize — often 1–3 minutes. You can close this modal; we keep polling the auction account.",
      });
    } catch (e) {
      reportError(e);
      setRevealUiPhase("idle");
      return;
    } finally {
      setBusy(null);
    }

    setRevealUiPhase("mxe");
    try {
      await awaitRevealWinnerFinalizedOrPoll(
        provider,
        program,
        auctionKey,
        computationOffset!,
        { timeoutMs: 10 * 60_000, pollMs: 1200 }
      );
      pushToast({
        kind: "info",
        title: "Reveal finalized",
        body: "Refreshing auction account…",
      });
      await refresh();
      await new Promise((r) => setTimeout(r, 1500));
      await refresh();
      const check = await fetchAuctionAccount(program, auctionKey);
      if (check && !check.revealed) {
        pushToast({
          kind: "warn",
          title: "Auction still sealed on RPC",
          body:
            "MXE callback may be delayed or failed. Confirm NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET matches arcium deploy.",
        });
      }
    } catch (e) {
      reportError(e);
      pushToast({
        kind: "warn",
        title: "Reveal still pending?",
        body:
          e instanceof Error
            ? e.message
            : "Refresh this page in a minute or check Solana Explorer.",
      });
    } finally {
      setRevealUiPhase("idle");
      void refresh();
    }
  }, [
    program,
    provider,
    publicKey,
    auctionKey,
    clusterOffset,
    pushFeed,
    pushToast,
    refresh,
    reportError,
  ]);

  if (!auctionKey) {
    return (
      <AppShell>
        <div className="mx-auto max-w-[1400px] px-4 py-16 sm:px-6 lg:px-8">
          <NavCrumb href="/auctions" label="back to auctions" />
          <h1 className="mt-3 text-2xl font-bold text-white">Invalid auction PDA</h1>
          <p className="mt-2 text-sm text-slate-400">
            <code className="rounded bg-black/35 px-1 text-slate-300">{auctionPda}</code>{" "}
            is not a valid base58 public key.
          </p>
        </div>
      </AppShell>
    );
  }

  const listingHeroSrc = snapshot ? listingImageSrc(snapshot.imageUri) : null;
  const bidCount = snapshot?.bidCount ?? 0;
  const progressSegments = 28;
  const progressFilled = Math.min(bidCount, progressSegments);
  const softMomentumDen = Math.max(12, bidCount + 4);
  const momentumPct = Math.min(100, Math.round((bidCount / softMomentumDen) * 100));

  const bidSliderValue = useMemo(() => {
    const n = parseFloat(bidInput.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(25, n);
  }, [bidInput]);

  const listingTitle = snapshot?.title?.trim()
    ? snapshot.title.trim()
    : truncateMid(auctionPda, 8, 8);

  const listingLive =
    !!snapshot &&
    !snapshot.revealed &&
    (!countdown.locked || countdown.running);

  const balSolDisplay =
    solBalance != null
      ? solBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })
      : "—";

  return (
    <AppShell>
      <RevealModal
        open={revealOpen}
        onClose={() => setRevealOpen(false)}
        auctionPda={auctionPda}
        bidCount={snapshot?.bidCount ?? null}
        myHighestLamports={myHighest}
        isAuthority={isAuthority}
        revealed={snapshot?.revealed ?? false}
        winnerB58={snapshot?.revealed ? snapshot.winnerB58 : null}
        winningBidLamports={snapshot?.revealed ? snapshot.winningBidLamports : null}
        mxeReady={!!mxePub && rpcReachable === true}
        triggering={revealUiPhase !== "idle"}
        triggerPhase={revealUiPhase === "idle" ? undefined : revealUiPhase}
        arciumClusterMisconfigured={arciumClusterMisconfigured}
        clusterOffset={clusterOffset}
        onTriggerReveal={() => void onReveal().catch(reportError)}
      />

      <div className="relative pb-20 pt-3 text-slate-100">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-500/40 to-transparent" />
        <div className="mx-auto w-full max-w-[min(100%,1580px)] px-3 sm:px-5 lg:px-8">
          {listingLive ? (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-fuchsia-400/35 bg-fuchsia-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-fuchsia-100">
                Live listing
              </span>
              <span className="text-[11px] text-slate-500">Listing · commit rail</span>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
            <Link
              href="/auctions"
              className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-widest text-slate-500 transition-colors hover:text-violet-300"
            >
              <ArrowRight className="h-3 w-3 rotate-180" />
              Back to auctions
            </Link>
            <button
              type="button"
              disabled={!snapshot}
              onClick={() => setRevealOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia-400/35 bg-fuchsia-500/15 px-4 py-2 text-xs font-semibold text-fuchsia-100 shadow-[0_0_24px_rgba(192,38,211,0.2)] backdrop-blur-sm transition-colors hover:bg-fuchsia-500/25 disabled:opacity-40"
            >
              <Trophy className="h-3.5 w-3.5 text-fuchsia-300" />
              {snapshot?.revealed
                ? "View winner"
                : countdown.locked && countdown.ended && isAuthority
                  ? "Reveal winner"
                  : "Reveal summary"}
            </button>
          </div>

          <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
            {/* Main column — flex-1 so listing uses horizontal space; rail stays fixed width */}
            <main className="min-h-0 min-w-0 w-full flex-1 space-y-5">
              <section
                id="deal-overview"
                className="overflow-hidden rounded-2xl border border-violet-500/25 bg-black/40 shadow-glass-lg shadow-[0_0_60px_rgba(99,102,241,0.12)]"
              >
                <div className="relative min-h-[220px] sm:min-h-[240px]">
                  {listingHeroSrc ? (
                    <>
                      <SafeRemoteImage
                        src={listingHeroSrc}
                        alt={listingTitle}
                        className="absolute inset-0 h-full w-full object-cover opacity-90"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/75 to-black/35" />
                    </>
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-violet-950/90 via-[#1a0a2e] to-black" />
                  )}
                  <div className="relative flex min-h-[260px] flex-col p-5 sm:min-h-[280px] sm:p-7">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white shadow-neon">
                        Sealed auction
                      </span>
                      {listingLive ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/60 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-100">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                          Live
                        </span>
                      ) : snapshot?.revealed ? (
                        <span className="rounded-full border border-amber-400/50 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-amber-100">
                          Settled
                        </span>
                      ) : (
                        <span className="rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white/90">
                          Open
                        </span>
                      )}
                      {isAuthority ? (
                        <span className="rounded-full border border-white/25 bg-white/10 px-2 py-0.5 text-[9px] font-semibold text-emerald-100">
                          You are authority
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.28em] text-violet-200/55">
                      Shadow Bid · Solana
                    </p>
                    <h1 className="mt-1.5 max-w-[min(100%,40rem)] text-balance text-xl font-bold leading-snug tracking-tight text-white sm:text-2xl lg:text-[1.65rem] xl:text-[1.85rem]">
                      {listingTitle}
                    </h1>
                    <p className="mt-2 max-w-xl text-[10px] font-semibold uppercase tracking-[0.22em] text-white/38">
                      Encrypted bids · on-chain settlement
                    </p>
                    <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-white/82 line-clamp-4 sm:line-clamp-none">
                      {snapshot?.description?.trim()
                        ? snapshot.description.trim()
                        : "Real-time sealed bids on Solana. Amounts stay encrypted until the authority runs reveal through Arcium MXC."}
                    </p>
                    <div className="mt-5 flex flex-wrap gap-2.5">
                      <button
                        type="button"
                        onClick={() =>
                          document.getElementById("deal-commit")?.scrollIntoView({
                            behavior: "smooth",
                          })
                        }
                        className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/40 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur-md hover:bg-black/55"
                      >
                        <Play className="h-4 w-4 fill-current" />
                        Place a sealed bid
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const url = `${window.location.origin}/auctions/${auctionPda}`;
                          void copyToClipboard("listing link", url);
                        }}
                        className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/15"
                      >
                        {copyFlash === "listing link" ? (
                          <Check className="h-4 w-4 text-emerald-300" />
                        ) : (
                          <Share2 className="h-4 w-4" />
                        )}
                        Copy invite link
                      </button>
                    </div>

                    <div className="mt-auto pt-6 sm:pt-8">
                      <div className="-mx-5 grid grid-cols-1 divide-y divide-white/10 border-t border-white/15 bg-black/70 backdrop-blur-md sm:-mx-7 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                      {[
                        {
                          k: "Sealed bids",
                          v: snapshot ? String(snapshot.bidCount) : "…",
                        },
                        { k: "Currency", v: "SOL" },
                        {
                          k: "Reveal",
                          v: snapshot?.revealed
                            ? "On-chain"
                            : countdown.locked && countdown.ended
                              ? "Ready"
                              : "Pending",
                        },
                      ].map((cell) => (
                        <div key={cell.k} className="px-4 py-3.5 sm:py-4">
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">
                            {cell.k}
                          </p>
                          <p className="mt-1 text-lg font-bold tracking-tight text-white sm:text-xl">
                            {cell.v}
                          </p>
                        </div>
                      ))}
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="glass-panel overflow-hidden rounded-2xl border-glow shadow-[0_0_40px_rgba(139,92,246,0.06)]">
                <div className="grid gap-0 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:divide-x lg:divide-white/[0.06]">
                  <div className="space-y-5 border-b border-white/[0.06] p-5 sm:p-6 lg:border-b-0">
                    <div>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
                          Participation pulse
                        </p>
                        <span className="font-mono text-[11px] font-semibold text-fuchsia-300/90">
                          {momentumPct}%
                        </span>
                      </div>
                      <p className="mt-1 text-sm font-semibold text-white">
                        {bidCount} sealed {bidCount === 1 ? "bid" : "bids"} on-chain
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Decorative pacing toward ~{softMomentumDen} bids · amounts stay private
                      </p>
                    </div>
                    <SegmentedBidBar filled={progressFilled} total={progressSegments} />
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-4">
                      <p className="text-[11px] text-slate-500">
                        MXE-finalized count only — no amounts leaked.
                      </p>
                      <div className="flex -space-x-1.5">
                        {Array.from({ length: Math.min(6, Math.max(3, bidCount + 2)) }, (_, i) => (
                          <div
                            key={i}
                            className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#0b0420] text-[9px] font-bold text-white shadow-md"
                            style={{
                              background: `linear-gradient(135deg, hsl(${265 + i * 14}, 70%, 58%), hsl(${310 + i * 10}, 65%, 48%))`,
                            }}
                          >
                            {String.fromCharCode(65 + (i % 26))}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.06] p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] font-black tracking-[0.2em] text-white">
                          ARCIUM
                        </span>
                        <a
                          href="https://arcium.com"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-300 hover:text-fuchsia-300"
                        >
                          Docs <ArrowRight className="h-3 w-3" />
                        </a>
                      </div>
                      <p className="mt-2 text-[13px] leading-snug text-slate-300">
                        <span className="font-semibold text-violet-200">Privacy rail.</span> Before
                        reveal, observers see ciphertext and{" "}
                        <code className="rounded bg-black/40 px-1 font-mono text-[11px] text-fuchsia-200">
                          bid_count
                        </code>{" "}
                        only.
                      </p>
                    </div>
                  </div>

                  <div className="relative bg-black/35 p-4 sm:p-5">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] text-violet-300/85">
                        <Radio className="h-3 w-3 animate-pulse" />
                        encrypted_state
                      </span>
                      <span className="rounded-md border border-fuchsia-400/35 bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-fuchsia-200">
                        {snapshot?.revealed ? "revealed" : "sealed · MXE"}
                      </span>
                    </div>
                    <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-black/50 ring-1 ring-inset ring-white/[0.03]">
                      <CiphertextRain
                        cols={22}
                        rows={6}
                        realBytes={snapshot?.encryptedStateBytes ?? null}
                        paused={revealOpen}
                      />
                    </div>
                    <p className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                      <Coins className="h-3 w-3 shrink-0 opacity-60" />
                      Values unlock after{" "}
                      <code className="rounded bg-black/50 px-1 font-mono text-slate-300">
                        reveal_winner
                      </code>
                      . Confirmed bids:{" "}
                      <span className="font-semibold text-fuchsia-300">{bidCount}</span>
                    </p>
                  </div>
                </div>
              </section>

              {snapshot?.revealed ? (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-2xl border border-amber-400/40 bg-gradient-to-br from-amber-500/15 via-fuchsia-500/10 to-violet-600/15 p-5 shadow-[0_0_36px_rgba(251,191,36,0.25)]"
                >
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-amber-200">
                    <Crown className="h-3 w-3" />
                    Winner
                  </div>
                  <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
                    <code className="font-mono text-base text-white sm:text-lg">
                      {truncateMid(snapshot.winnerB58, 6, 6)}
                    </code>
                    <span className="font-mono text-2xl text-fuchsia-100">
                      {lamportsToSolDisplayWithSuffix(snapshot.winningBidLamports)}
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] text-amber-200/70">
                    Decrypted by Arcium MXE via{" "}
                    <code className="rounded bg-black/40 px-1 font-mono text-amber-100">
                      reveal_winner
                    </code>
                    .
                  </p>
                  {snapshot.bidCount === 0 ? (
                    <p className="mt-2 text-[11px] text-amber-300/85">
                      MXE bid count is zero while SOL looks huge—ignore for settlement; redeploy
                      listing after fix.
                    </p>
                  ) : null}
                </motion.div>
              ) : null}

              <section className="glass-panel rounded-2xl p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-violet-200/90">
                    Deal metadata
                  </h3>
                  {listingLive ? (
                    <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">
                      Live
                    </span>
                  ) : null}
                </div>
                <div className="grid gap-0 lg:grid-cols-2 lg:gap-x-10">
                  <div>
                    <DealDetailRow label="Listing" value={truncateMid(auctionPda, 12, 12)} />
                    <DealDetailRow label="Auction type" value="Sealed bid (MPC)" />
                    <DealDetailRow label="Currency" value="SOL (encrypted bid)" />
                  </div>
                  <div>
                    <DealDetailRow label="Confirmed bids" value={String(bidCount)} />
                    <DealDetailRow
                      label="State nonce"
                      value={snapshot ? truncateMid(snapshot.stateNonce, 6, 6) : "…"}
                    />
                  </div>
                </div>
                <div className="mt-5 flex flex-col gap-3 border-t border-white/[0.06] pt-5 sm:flex-row sm:flex-wrap sm:items-center">
                  <div className="grid min-w-0 flex-1 grid-cols-2 gap-3 sm:max-w-md">
                    <DealStatCard
                      label="Bids"
                      value={snapshot ? String(snapshot.bidCount) : "—"}
                    />
                    <DealStatCard
                      label="Your max"
                      mono
                      value={
                        myHighest != null
                          ? lamportsToSolDisplayWithSuffix(myHighest)
                          : "—"
                      }
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void copyToClipboard("auction PDA", auctionPda)}
                      className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-slate-300 hover:border-violet-400/35 hover:text-white"
                    >
                      {copyFlash === "auction PDA" ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      Copy PDA
                    </button>
                    {snapshot ? (
                      <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                        <UserIcon className="h-3.5 w-3.5" />
                        Synced {timeAgo(snapshot.fetchedAt)}
                      </span>
                    ) : null}
                  </div>
                </div>
              </section>
            </main>

            {/* Commit + deadline rail */}
            <aside
              id="deal-commit"
              className="min-h-0 min-w-0 w-full shrink-0 space-y-5 lg:sticky lg:top-24 lg:w-[min(100%,380px)] lg:max-w-[380px]"
            >
              <div className="glass-panel relative overflow-hidden rounded-2xl border-glow p-5 shadow-glass-lg">
                <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-fuchsia-600/20 blur-3xl" />
                <div className="pointer-events-none absolute -bottom-12 -left-12 h-36 w-36 rounded-full bg-violet-600/20 blur-3xl" />
                <div className="relative">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold text-white">Commit sealed bid</h2>
                    <p className="mt-1 max-w-[18rem] text-[11px] leading-snug text-slate-500">
                      Amount stays encrypted until reveal. The capsule mirrors your on-chain
                      deadline.
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-center rounded-xl border border-fuchsia-500/35 bg-black/50 px-4 py-2.5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_0_28px_rgba(192,38,211,0.12)]">
                    <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-slate-500">
                      Closes in
                    </span>
                    <span
                      className={`mt-1 font-mono text-xl font-bold tracking-tight sm:text-2xl ${
                        countdown.running
                          ? "text-glow-subtle text-fuchsia-200"
                          : "text-slate-500"
                      }`}
                      suppressHydrationWarning
                    >
                      {countdown.locked
                        ? formatCountdown(countdown.remainingMs)
                        : "—"}
                    </span>
                  </div>
                </div>

                {arciumClusterMisconfigured ? (
                  <div className="mt-4 rounded-xl border border-amber-400/35 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-100/95">
                    Set{" "}
                    <code className="rounded bg-black/35 px-1">
                      NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET
                    </code>{" "}
                    to match <code className="font-mono">arcium deploy -o …</code> or bids stall.
                  </div>
                ) : null}

                {!connected ? (
                  <button
                    type="button"
                    onClick={openWalletModal}
                    className="mt-6 w-full rounded-xl border border-violet-400/40 bg-gradient-to-r from-violet-600 via-fuchsia-600 to-indigo-600 py-3.5 text-sm font-bold text-white shadow-[0_0_28px_rgba(192,38,211,0.35)] hover:brightness-110"
                  >
                    Connect wallet
                  </button>
                ) : (
                  <>
                    <div className="mt-6 flex items-center justify-between text-xs text-slate-500">
                      <span>Wallet balance</span>
                      <span className="font-mono font-semibold text-violet-200">
                        {balSolDisplay} SOL
                      </span>
                    </div>
                    <label className="mt-4 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Commit amount
                      <span className="mt-0.5 block text-[10px] font-normal normal-case tracking-normal text-slate-500">
                        Sealed in SOL · ciphertext on-chain
                      </span>
                    </label>
                    <div className="mt-2 flex rounded-xl border border-white/10 bg-black/35 focus-within:border-violet-400/50 focus-within:shadow-[0_0_20px_rgba(139,92,246,0.2)]">
                      <span className="flex items-center border-r border-white/10 px-3 text-xs font-bold text-violet-300">
                        ◎
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={bidInput}
                        onChange={(e) => setBidInput(e.target.value)}
                        disabled={!!snapshot?.revealed}
                        className="input-glow w-full rounded-r-xl bg-transparent px-3 py-3 font-mono text-lg text-white outline-none placeholder:text-slate-600 disabled:opacity-50"
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {QUICK_SOL_AMTS.map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          disabled={!!snapshot?.revealed}
                          onClick={() => setBidInput(amt)}
                          className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-300 hover:border-violet-400/35 hover:text-white disabled:opacity-40"
                        >
                          {amt} SOL
                        </button>
                      ))}
                    </div>

                    <div className="mt-5">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>Bid size (0–25 SOL)</span>
                        <span className="font-mono text-violet-200">
                          {bidSliderValue.toFixed(2)} SOL
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={25}
                        step={0.05}
                        value={bidSliderValue}
                        onChange={(e) =>
                          setBidInput(Number(e.target.value).toFixed(2))
                        }
                        disabled={!!snapshot?.revealed}
                        className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-violet-500 disabled:opacity-40"
                      />
                    </div>

                    <div className="mt-4 space-y-2 rounded-xl border border-white/[0.06] bg-black/30 px-3.5 py-3 text-[13px]">
                      <div className="flex justify-between gap-2">
                        <span className="text-slate-500">Your cached high</span>
                        <span className="font-mono font-semibold text-slate-100">
                          {myHighest != null
                            ? lamportsToSolDisplayWithSuffix(myHighest)
                            : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-slate-500">MXE status</span>
                        <span
                          className={`font-semibold ${
                            mxePub ? "text-emerald-300" : "text-amber-300"
                          }`}
                        >
                          {rpcReachable === false
                            ? "RPC offline"
                            : mxePub
                              ? "Ready"
                              : "Loading"}
                        </span>
                      </div>
                      <p className="text-[11px] leading-snug text-slate-500">
                        Footprint: one encrypted bid instruction plus MXC finalize. Bid ciphertext
                        stays private until reveal.
                      </p>
                    </div>

                    <motion.button
                      type="button"
                      onClick={() => void onSubmitBid().catch(reportError)}
                      disabled={
                        !!busy ||
                        rpcReachable === false ||
                        !bidInput.trim() ||
                        !mxePub ||
                        !!snapshot?.revealed
                      }
                      whileHover={{ scale: busy ? 1 : 1.01 }}
                      whileTap={{ scale: busy ? 1 : 0.99 }}
                      className="shadow-neon-strong relative mt-5 min-h-[3rem] w-full overflow-hidden rounded-2xl border border-violet-400/30 bg-gradient-to-r from-violet-600 via-fuchsia-600 to-indigo-600 px-4 py-3 text-sm font-semibold leading-snug tracking-normal text-white disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-0 sm:py-3.5 sm:text-[15px]"
                    >
                      <span className="relative z-10 inline-flex w-full items-center justify-center gap-2 text-center">
                        {busy ? (
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin sm:h-[1.125rem] sm:w-[1.125rem]" />
                        ) : (
                          <Zap className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
                        )}
                        <span className="min-w-0 break-words">
                          {snapshot?.revealed
                            ? "Auction settled"
                            : busy ?? `Commit ${bidInput.trim() || "0"} SOL (sealed)`}
                        </span>
                      </span>
                    </motion.button>

                    {!mxePub && rpcReachable === true ? (
                      <p className="mt-2 text-center text-[11px] leading-snug text-amber-300/80">
                        Waiting for MXE pubkey… initialize circuits if this persists.
                      </p>
                    ) : null}

                    <p className="mt-3 text-center text-[11px] leading-relaxed text-slate-500">
                      Fees cover network fees and your bid instruction. Check transactions in an
                      explorer.
                      {isAuthority && !snapshot?.revealed ? (
                        <>
                          {" "}
                          <button
                            type="button"
                            onClick={() => setRevealOpen(true)}
                            className="text-amber-200/95 underline decoration-amber-400/35 underline-offset-2 hover:text-amber-100"
                          >
                            Authority reveal
                          </button>
                          .
                        </>
                      ) : null}
                    </p>
                  </>
                )}
                </div>
              </div>

              <EpochTimer
                biddingEndsAtUnixSec={snapshot?.biddingEndsAt ?? null}
                canSet={isAuthority}
                canCallChain={!!program && rpcReachable === true}
                countdownOverride={countdownOverride}
                onSetDeadline={(s) =>
                  onSetDeadline(s).catch((e) => {
                    reportError(e);
                    throw e;
                  })
                }
              />
            </aside>
          </div>

          <section className="mt-10 rounded-2xl border border-white/[0.08] bg-black/20 p-5 shadow-inner backdrop-blur-md sm:p-6">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Activity className="h-4 w-4 text-violet-400" />
              <h3 className="font-semibold text-white">Session activity</h3>
              <span className="text-[10px] uppercase tracking-widest text-slate-500">
                this browser
              </span>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {feed.length === 0 ? (
                <li className="col-span-full rounded-xl border border-dashed border-white/[0.08] px-4 py-8 text-center text-xs text-slate-500">
                  Actions from this session appear here. Use the activity drawer in the nav for the
                  full feed.
                </li>
              ) : (
                feed.slice(0, 12).map((row) => {
                  const sigMatch = /tx ([1-9A-HJ-NP-Za-km-z]+)/.exec(row.msg);
                  return (
                    <li
                      key={row.id}
                      className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 text-sm text-slate-100"
                    >
                      <p className="leading-snug">{row.msg}</p>
                      <p
                        className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500"
                        suppressHydrationWarning
                      >
                        <span>{timeAgo(row.ts)}</span>
                        {sigMatch ? (
                          <a
                            href={explorerTxUrl(rpcEndpoint, sigMatch[1])}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-violet-300/90 hover:text-violet-200"
                          >
                            explorer <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                      </p>
                    </li>
                  );
                })
              )}
            </ul>
          </section>
        </div>
      </div>
    </AppShell>
  );
}

function DealStatCard({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="glass-panel rounded-xl border border-white/[0.06] p-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
      <p
        className={`mt-1 text-lg font-semibold text-violet-100 ${mono ? "font-mono text-base" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}
