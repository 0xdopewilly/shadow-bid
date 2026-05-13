"use client";

import { AppShell, NavCrumb } from "@/components/shadow-bid/AppShell";
import { CiphertextRain } from "@/components/shadow-bid/CiphertextRain";
import { EpochTimer } from "@/components/shadow-bid/EpochTimer";
import { RevealModal } from "@/components/shadow-bid/RevealModal";
import { useShadowBid } from "@/components/shadow-bid/ShadowBidContext";
import { SafeRemoteImage } from "@/components/shadow-bid/SafeRemoteImage";
import {
  coerceAnchorU32,
  fetchAuctionAccount,
  listingImageSrc,
  placeBidFlow,
  revealWinnerFlow,
  setAuctionDeadlineFlow,
} from "@/lib/shadow-bid/flows";
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
  Check,
  Coins,
  Copy,
  Crown,
  ExternalLink,
  Hash,
  Loader2,
  Lock,
  Radio,
  Share2,
  Shield,
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
  /** On-chain deadline (unix seconds). 0 = unset. */
  biddingEndsAt: number;
  /** Listing metadata (public on-chain). */
  title: string;
  description: string;
  imageUri: string;
  fetchedAt: number;
};

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

function lamportsStrToSol(s: string) {
  try {
    return (Number(BigInt(s)) / 1e9).toLocaleString(undefined, {
      maximumFractionDigits: 9,
    });
  } catch {
    return "—";
  }
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
  const [revealing, setRevealing] = useState(false);
  const [epochEnded, setEpochEnded] = useState(false);
  const lastSeenBidCount = useRef<number | null>(null);

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
    const t = setInterval(() => void refresh(), 7000);
    return () => clearInterval(t);
  }, [refresh]);

  // Outbid toast on bid count delta when the user has a stored bid
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

  // Event listeners
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
              pushFeed(
                `Winner revealed · ${truncateMid(ev.winner.toBase58(), 4, 4)} took it`,
                true
              );
              pushToast({
                kind: "info",
                title: "Winner revealed",
                body: `${truncateMid(ev.winner.toBase58(), 4, 4)} won ${(
                  Number(ev.winningBid.toString()) / 1e9
                ).toLocaleString(undefined, { maximumFractionDigits: 9 })} SOL.`,
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
  }, [program, auctionKey, pushFeed, pushToast, refresh, refreshAllAuctions, rpcReachable]);

  useEffect(() => {
    const end = snapshot?.biddingEndsAt;
    if (!end || end <= 0) {
      setEpochEnded(false);
      return;
    }
    const tick = () => setEpochEnded(end * 1000 - Date.now() <= 0);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [snapshot?.biddingEndsAt]);

  const isAuthority = useMemo(() => {
    if (!publicKey || !snapshot) return false;
    return publicKey.equals(snapshot.authority);
  }, [publicKey, snapshot]);

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
    setBusy("Encrypting & sending sealed bid…");
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
        title: "Sealed bid sent",
        body: "Encrypted in your browser. The MXE compares without decrypting.",
      });
      setBidInput("");
      await refresh();
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
    setRevealing(true);
    setBusy("Queuing reveal_winner Arcium computation…");
    try {
      const { txSig } = await revealWinnerFlow(
        program,
        provider,
        clusterOffset,
        publicKey,
        auctionKey
      );
      pushFeed(`reveal_winner finalized · tx ${truncateMid(txSig, 6, 6)}`, true);
      await refresh();
    } finally {
      setBusy(null);
      setRevealing(false);
    }
  }, [program, provider, publicKey, auctionKey, clusterOffset, pushFeed, refresh]);

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
        triggering={revealing}
        onTriggerReveal={() => void onReveal().catch(reportError)}
      />

      <div className="mx-auto w-full max-w-[1400px] px-4 pt-8 sm:px-6 lg:px-8">
        <NavCrumb href="/auctions" label="back to auctions" />
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">
              {snapshot?.revealed ? (
                <>
                  <Trophy className="h-3.5 w-3.5 text-amber-300" />
                  revealed auction
                </>
              ) : (
                <>
                  <Lock className="h-3.5 w-3.5 text-violet-300" />
                  sealed auction
                </>
              )}
              {isAuthority ? (
                <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] text-emerald-200">
                  you are authority
                </span>
              ) : null}
            </div>
            <h1 className="mt-1 text-balance text-2xl font-bold text-white sm:text-3xl">
              {snapshot?.title?.trim()
                ? snapshot.title.trim()
                : truncateMid(auctionPda, 8, 8)}
            </h1>
            {snapshot?.title?.trim() ? (
              <p className="mt-1 font-mono text-xs text-slate-500">{truncateMid(auctionPda, 10, 10)}</p>
            ) : null}
            {snapshot?.description?.trim() ? (
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-400">
                {snapshot.description.trim()}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
              <button
                type="button"
                onClick={() => void copyToClipboard("auction PDA", auctionPda)}
                className="inline-flex items-center gap-1 rounded border border-white/10 px-1.5 py-0.5 hover:text-white"
              >
                {copyFlash === "auction PDA" ? (
                  <Check className="h-3 w-3 text-emerald-400" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                copy address
              </button>
              <button
                type="button"
                onClick={() => {
                  const url = `${window.location.origin}/auctions/${auctionPda}`;
                  void copyToClipboard("listing link", url);
                }}
                className="inline-flex items-center gap-1 rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-violet-200/90 hover:bg-violet-500/20 hover:text-white"
              >
                {copyFlash === "listing link" ? (
                  <Check className="h-3 w-3 text-emerald-400" />
                ) : (
                  <Share2 className="h-3 w-3" />
                )}
                copy invite link
              </button>
              {snapshot ? (
                <>
                  <span className="inline-flex items-center gap-1">
                    <UserIcon className="h-3 w-3" />
                    by <code className="text-slate-400">{truncateMid(snapshot.authority.toBase58(), 4, 4)}</code>
                  </span>
                  <span>· last synced {timeAgo(snapshot.fetchedAt)}</span>
                </>
              ) : null}
            </div>
            <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-slate-500">
              Bidders use their own wallets on the same cluster as this app. Share the invite link (or browse{" "}
              <Link href="/auctions" className="text-violet-400/90 hover:text-violet-300">
                Auctions
              </Link>
              ); bid amounts stay sealed until the authority reveals.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!snapshot}
              onClick={() => setRevealOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia-400/35 bg-fuchsia-500/10 px-3 py-1.5 text-xs font-semibold text-fuchsia-100 hover:bg-fuchsia-500/20 disabled:opacity-40"
            >
              <Trophy className="h-3.5 w-3.5" />
              {snapshot?.revealed
                ? "View winner"
                : epochEnded && isAuthority
                  ? "Reveal winner"
                  : "Reveal summary"}
            </button>
          </div>
        </div>
      </div>

      {listingHeroSrc ? (
        <div className="mx-auto mt-6 w-full max-w-[1400px] px-4 sm:px-6 lg:px-8">
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/40 shadow-[0_0_40px_rgba(99,102,241,0.12)]">
            <SafeRemoteImage
              src={listingHeroSrc}
              alt={snapshot?.title?.trim() ? snapshot.title.trim() : "Listing"}
              className="max-h-[min(420px,52vh)] w-full object-cover"
            />
          </div>
        </div>
      ) : null}

      {/* Main grid */}
      <div className="mx-auto mt-8 grid w-full max-w-[1400px] gap-6 px-4 pb-12 sm:px-6 lg:grid-cols-[1.4fr_1fr] lg:gap-8 lg:px-8">
        {/* LEFT: Terminal */}
        <div className="flex flex-col gap-6">
          <div className="relative scanline rounded-2xl border border-violet-400/25 bg-black/45 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.22em] text-violet-300/85">
                <Radio className="h-3 w-3 animate-pulse" />
                encrypted_state[0..28]
              </span>
              <span className="rounded-md border border-fuchsia-400/35 bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-fuchsia-200">
                {snapshot?.revealed ? "revealed" : "sealed · MXE only"}
              </span>
            </div>
            <CiphertextRain
              cols={28}
              rows={8}
              realBytes={snapshot?.encryptedStateBytes ?? null}
              paused={revealOpen}
            />
            <p className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <Coins className="h-3 w-3 opacity-60" />
              Sealed state — only the MXE can read this row
              {snapshot ? (
                <>
                  <span>·</span>
                  <span className="text-violet-300/90">
                    MXE-confirmed sealed bids: {snapshot.bidCount}
                  </span>
                </>
              ) : null}
            </p>
          </div>

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
                  {lamportsStrToSol(snapshot.winningBidLamports)} SOL
                </span>
              </div>
              <p className="mt-2 text-[11px] text-amber-200/70">
                Decrypted by the Arcium MXE cluster via{" "}
                <code className="rounded bg-black/40 px-1 text-amber-100">reveal_winner</code>.
                Losing amounts remain sealed forever.
              </p>
            </motion.div>
          ) : null}

          <EpochTimer
            biddingEndsAtUnixSec={snapshot?.biddingEndsAt ?? null}
            canSet={isAuthority}
            canCallChain={!!program && rpcReachable === true}
            onEnded={() => setEpochEnded(true)}
            onSetDeadline={(s) => onSetDeadline(s).catch((e) => { reportError(e); throw e; })}
          />

          <div className="rounded-2xl border border-white/[0.08] bg-[linear-gradient(160deg,rgba(15,8,40,0.55)_0%,rgba(35,10,60,0.45)_100%)] p-5 backdrop-blur-md">
            <div className="mb-4 flex items-center gap-2">
              <Shield className="h-4 w-4 text-violet-300" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-violet-200/85">
                Place your sealed bid
              </h2>
            </div>

            {!connected ? (
              <button
                type="button"
                onClick={openWalletModal}
                className="w-full rounded-xl border border-violet-400/40 bg-gradient-to-r from-violet-600 via-fuchsia-600 to-indigo-600 py-3 text-sm font-semibold text-white shadow-[0_0_28px_rgba(192,38,211,0.35)]"
              >
                Connect wallet to bid
              </button>
            ) : (
              <>
                <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-400">
                  Your sealed amount (SOL)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={bidInput}
                  onChange={(e) => setBidInput(e.target.value)}
                  disabled={!!snapshot?.revealed}
                  className="mb-4 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3.5 font-mono text-lg text-white outline-none transition-all duration-300 placeholder:text-slate-600 input-glow disabled:opacity-50"
                />

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
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  className="relative w-full overflow-hidden rounded-2xl border border-violet-400/30 bg-gradient-to-r from-violet-600 via-fuchsia-600 to-indigo-600 py-3.5 text-base font-bold tracking-wide text-white shadow-neon-strong disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    {busy?.includes("Encrypting") ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Zap className="h-5 w-5" />
                    )}
                    {snapshot?.revealed
                      ? "Auction revealed — bidding closed"
                      : busy || "Submit Secret Bid"}
                  </span>
                </motion.button>

                {!mxePub && rpcReachable === true ? (
                  <p className="mt-2 text-[11px] text-amber-300/80">
                    MXE pubkey loading… make sure circuits are initialized.
                  </p>
                ) : null}

                {isAuthority && !snapshot?.revealed ? (
                  <button
                    type="button"
                    disabled={revealing || !mxePub}
                    onClick={() => void onReveal().catch(reportError)}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-amber-400/40 bg-gradient-to-r from-amber-500/20 via-fuchsia-500/20 to-violet-500/20 py-2.5 text-sm font-semibold text-amber-100 shadow-[0_0_24px_rgba(251,191,36,0.25)] disabled:opacity-50"
                  >
                    {revealing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Crown className="h-4 w-4" />
                    )}
                    {revealing ? "Decrypting on-chain…" : "Trigger on-chain reveal_winner"}
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>

        {/* RIGHT: Stats + Activity */}
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3">
            <SnapshotStat
              label="Confirmed sealed bids"
              value={snapshot ? `${snapshot.bidCount}` : "—"}
            />
            <SnapshotStat
              label="State nonce"
              mono
              value={
                snapshot ? truncateMid(snapshot.stateNonce, 4, 4) : "—"
              }
              icon={Hash}
            />
            <SnapshotStat
              label="Your highest"
              mono
              value={
                myHighest != null
                  ? `${(Number(myHighest) / 1e9).toLocaleString(undefined, {
                      maximumFractionDigits: 9,
                    })} SOL`
                  : "—"
              }
            />
            <SnapshotStat
              label="MXE"
              value={
                rpcReachable === false
                  ? "RPC offline"
                  : mxePub
                    ? "ready"
                    : "pending"
              }
              tone={
                mxePub
                  ? "ok"
                  : rpcReachable === false
                    ? "warn"
                    : "neutral"
              }
            />
          </div>
          <p className="text-[10px] leading-snug text-slate-500">
            This counter tracks finalized bids only — your wallet tx confirms first; the Arcium
            callback increments <span className="font-mono text-slate-400">bid_count</span> a few
            seconds later (refresh happens automatically).
          </p>

          <div className="rounded-2xl border border-white/10 bg-black/30 p-5 backdrop-blur-md">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/20 text-violet-200">
                <Activity className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-white">Activity</h3>
                <p className="text-[10px] uppercase tracking-widest text-slate-500">
                  on-chain events
                </p>
              </div>
            </div>
            <ul className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {feed.length === 0 ? (
                <li className="text-xs text-slate-500 px-1 py-3">
                  Successful actions for this session land here. Open the activity drawer
                  in the nav for the full feed.
                </li>
              ) : (
                feed.slice(0, 12).map((row) => {
                  const sigMatch = /tx ([1-9A-HJ-NP-Za-km-z]+)/.exec(row.msg);
                  return (
                    <li
                      key={row.id}
                      className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 text-sm"
                    >
                      <p className="text-slate-100 leading-snug">{row.msg}</p>
                      <p className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-500" suppressHydrationWarning>
                        <span>{timeAgo(row.ts)}</span>
                        {sigMatch ? (
                          <a
                            href={explorerTxUrl(rpcEndpoint, sigMatch[1])}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-violet-300/80 hover:text-violet-200"
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
          </div>

          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 text-xs text-slate-400">
            <h4 className="mb-2 text-sm font-semibold text-violet-200/90">
              Quick links
            </h4>
            <ul className="space-y-2">
              <li>
                <Link href="/dashboard" className="inline-flex items-center gap-1 text-slate-200 hover:text-violet-200">
                  → Your private dashboard
                </Link>
              </li>
              <li>
                <Link href="/about" className="inline-flex items-center gap-1 text-slate-200 hover:text-violet-200">
                  → How sealed bids work
                </Link>
              </li>
              <li>
                <Link href="/auctions" className="inline-flex items-center gap-1 text-slate-200 hover:text-violet-200">
                  → Browse other auctions
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function SnapshotStat({
  label,
  value,
  icon: Icon,
  mono,
  tone = "neutral",
}: {
  label: string;
  value: string;
  icon?: typeof Hash;
  mono?: boolean;
  tone?: "neutral" | "ok" | "warn";
}) {
  const toneClasses =
    tone === "ok"
      ? "border-emerald-500/30 text-emerald-200"
      : tone === "warn"
        ? "border-amber-500/30 text-amber-200"
        : "border-white/[0.07] text-violet-100";
  return (
    <div className={`rounded-xl border bg-white/[0.03] p-3 ${toneClasses}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
        {Icon ? <Icon className="h-3 w-3" /> : null}
        {label}
      </div>
      <div className={`mt-1 text-lg ${mono ? "font-mono" : "font-semibold"}`}>
        {value}
      </div>
    </div>
  );
}
