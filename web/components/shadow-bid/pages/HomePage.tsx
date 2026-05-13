"use client";

import { AppShell } from "@/components/shadow-bid/AppShell";
import { AuctionCard } from "@/components/shadow-bid/AuctionCard";
import { CiphertextRain } from "@/components/shadow-bid/CiphertextRain";
import { useShadowBid } from "@/components/shadow-bid/ShadowBidContext";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Gavel,
  Lock,
  Radio,
  ShieldOff,
  Sparkles,
  Trophy,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

const FEATURES = [
  {
    icon: Lock,
    title: "True sealed bids",
    body:
      "RescueCipher + X25519 encrypts in your browser. The raw u64 never touches the wire.",
  },
  {
    icon: ShieldOff,
    title: "MEV immune",
    body:
      "The mempool only sees ciphertext. There's nothing for sandwich bots to read.",
  },
  {
    icon: EyeOff,
    title: "Loser privacy forever",
    body:
      "Losing amounts are sealed by the MXE permanently. Only the winner is unmasked.",
  },
  {
    icon: Trophy,
    title: "ZK winner reveal",
    body:
      "Authority calls reveal_winner — the MXE decrypts only the winning amount + bidder.",
  },
];

export function HomePage() {
  const { connected, openWalletModal, allAuctions, walletPk } = useShadowBid();

  const featured = useMemo(() => {
    const sorted = [...allAuctions].sort((a, b) => {
      // revealed last, more bids first
      if (a.revealed !== b.revealed) return a.revealed ? 1 : -1;
      return b.bidCount - a.bidCount;
    });
    return sorted.slice(0, 6);
  }, [allAuctions]);

  const totalBids = useMemo(
    () => allAuctions.reduce((acc, a) => acc + a.bidCount, 0),
    [allAuctions]
  );
  const liveAuctions = useMemo(
    () => allAuctions.filter((a) => !a.revealed).length,
    [allAuctions]
  );
  const revealedAuctions = useMemo(
    () => allAuctions.filter((a) => a.revealed).length,
    [allAuctions]
  );

  return (
    <AppShell>
      <section className="relative">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="absolute -top-40 left-1/2 h-[500px] w-[800px] -translate-x-1/2 opacity-50 blur-3xl"
            style={{
              background:
                "radial-gradient(ellipse at center, rgba(139,92,246,0.55), transparent 60%)",
            }}
          />
        </div>

        <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:px-8 lg:py-20">
          <div className="flex flex-col gap-5">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-violet-500/30 bg-white/[0.04] px-3 py-1 text-[10px] font-medium uppercase tracking-[0.22em] text-violet-300/90">
              <Sparkles className="h-3 w-3" />
              Powered by Arcium MXE
            </span>
            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="text-4xl font-bold leading-[1.02] tracking-tight text-white sm:text-5xl md:text-6xl xl:text-7xl text-glow"
            >
              Sealed bids that <span className="text-violet-300">stay sealed</span>.
              <br />
              On Solana.
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.55 }}
              className="max-w-xl text-base text-slate-400 sm:text-lg"
            >
              ShadowBid runs auctions inside an Arcium multi-party computation cluster. Your
              bid is encrypted in your browser; the global highest-bid state is encrypted
              on-chain; only the winner is ever revealed.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18, duration: 0.55 }}
              className="mt-2 flex flex-wrap items-center gap-3"
            >
              <Link
                href="/auctions"
                className="inline-flex items-center gap-2 rounded-full border border-violet-400/40 bg-gradient-to-r from-violet-600 via-fuchsia-600 to-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-[0_0_28px_rgba(192,38,211,0.45)] hover:brightness-110"
              >
                <Gavel className="h-4 w-4" />
                Browse auctions
                <ArrowRight className="h-4 w-4" />
              </Link>
              {connected ? (
                <Link
                  href="/auctions"
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-3 text-sm font-medium text-slate-200 hover:bg-white/10"
                >
                  <Zap className="h-4 w-4" />
                  Create your auction
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={openWalletModal}
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-3 text-sm font-medium text-slate-200 hover:bg-white/10"
                >
                  <Zap className="h-4 w-4" />
                  Connect wallet
                </button>
              )}
            </motion.div>

            <div className="mt-8 grid grid-cols-3 gap-3 max-w-md">
              <Stat label="Live auctions" value={liveAuctions} />
              <Stat
                label="Total bids"
                value={totalBids}
                hint="Sum of Arcium-finalized sealed bids across listings (wallet confirms first; counter follows)."
              />
              <Stat label="Settled" value={revealedAuctions} />
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-6 rounded-[2rem] opacity-60 blur-3xl"
              style={{
                background:
                  "radial-gradient(ellipse at center, rgba(192,38,211,0.45), transparent 65%)",
              }}
            />
            <div className="relative scanline rounded-[1.75rem] border border-violet-400/30 bg-black/40 p-5 backdrop-blur-xl shadow-[0_0_60px_rgba(99,102,241,0.25)]">
              <div className="mb-3 flex items-center justify-between">
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.22em] text-violet-300/80">
                  <Radio className="h-3 w-3 animate-pulse" />
                  encrypted_state[0..28]
                </span>
                <span className="rounded-md border border-fuchsia-400/35 bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-fuchsia-200">
                  sealed
                </span>
              </div>
              <CiphertextRain cols={28} rows={9} />
              <p className="mt-3 text-[11px] text-slate-500">
                The same bytes that live on-chain — meaningless without the MPC cluster.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="border-t border-white/5 bg-black/15">
        <div className="mx-auto grid max-w-[1400px] gap-4 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5 backdrop-blur-md"
            >
              <f.icon className="h-5 w-5 text-violet-300" />
              <h3 className="mt-3 text-sm font-semibold text-white">{f.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* RECENT AUCTIONS */}
      <section className="mx-auto w-full max-w-[1400px] px-4 py-14 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-white sm:text-3xl">Recent auctions</h2>
            <p className="mt-1 text-sm text-slate-400">
              Anyone can bid. Only the seller can reveal.
            </p>
          </div>
          <Link
            href="/auctions"
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10"
          >
            See all
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {featured.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-10 text-center">
            <Eye className="mx-auto h-6 w-6 text-violet-300/60" />
            <p className="mt-2 text-sm text-slate-300">No auctions on this cluster yet.</p>
            <p className="mt-1 text-xs text-slate-500">
              {connected
                ? "Open Auctions to create the first listing."
                : "Connect a wallet to create a listing."}
            </p>
            <Link
              href="/auctions"
              className="mt-4 inline-flex items-center gap-1 rounded-lg border border-violet-400/40 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-100 hover:bg-violet-500/20"
            >
              Create auction
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((a) => (
              <AuctionCard
                key={a.pda.toBase58()}
                auction={a}
                isMine={walletPk === a.authority.toBase58()}
              />
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div
      className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"
      title={hint}
    >
      <div className="font-mono text-2xl text-violet-100">{value}</div>
      <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
    </div>
  );
}
