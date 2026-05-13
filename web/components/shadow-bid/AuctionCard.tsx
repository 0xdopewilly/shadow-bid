"use client";

import { SafeRemoteImage } from "@/components/shadow-bid/SafeRemoteImage";
import { listingImageSrc, type AuctionListEntry } from "@/lib/shadow-bid/flows";
import { lamportsToSolDisplayWithSuffix } from "@/lib/shadow-bid/lamportsDisplay";
import { motion } from "framer-motion";
import { Crown, Lock, Trophy, User as UserIcon } from "lucide-react";
import Link from "next/link";

function shortPk(b58: string, a = 4, b = 4) {
  if (b58.length <= a + b + 1) return b58;
  return `${b58.slice(0, a)}…${b58.slice(-b)}`;
}

interface Props {
  auction: AuctionListEntry;
  /** Highlight when the connected wallet is the authority. */
  isMine?: boolean;
  /** Show "place bid" CTA color when neither yours nor revealed. */
  showCta?: boolean;
}

export function AuctionCard({ auction, isMine, showCta = true }: Props) {
  const pdaB58 = auction.pda.toBase58();
  const revealed = auction.revealed;
  const title = auction.title?.trim() ?? "";
  const desc = auction.description?.trim() ?? "";
  const imgSrc = listingImageSrc(auction.imageUri);

  return (
    <motion.div
      whileHover={{ y: -2, scale: 1.005 }}
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
      className={`group relative overflow-hidden rounded-2xl border p-5 backdrop-blur-md ${
        revealed
          ? "border-amber-400/30 bg-gradient-to-br from-amber-500/8 via-fuchsia-500/8 to-violet-600/10"
          : "border-white/[0.08] bg-white/[0.03] hover:border-violet-400/35"
      }`}
    >
      <div
        className="pointer-events-none absolute -inset-32 opacity-0 blur-3xl transition-opacity group-hover:opacity-30"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(139,92,246,0.45), transparent 60%)",
        }}
      />

      {imgSrc ? (
        <div className="relative -mx-5 -mt-5 mb-4 overflow-hidden rounded-t-2xl border-b border-white/[0.08] bg-black/40">
          <SafeRemoteImage
            src={imgSrc}
            alt=""
            className="h-36 w-full object-cover"
          />
        </div>
      ) : null}

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {revealed ? (
              <Trophy className="h-3.5 w-3.5 text-amber-300" />
            ) : (
              <Lock className="h-3.5 w-3.5 text-violet-300" />
            )}
            <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">
              {revealed ? "revealed" : "sealed"}
            </span>
            {isMine ? (
              <span className="ml-1 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-200">
                yours
              </span>
            ) : null}
          </div>
          {title ? (
            <>
              <p className="mt-1 truncate text-base font-semibold tracking-tight text-white">
                {title}
              </p>
              <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
                {shortPk(pdaB58, 6, 6)}
              </p>
            </>
          ) : (
            <p className="mt-1 truncate font-mono text-base text-white">
              {shortPk(pdaB58, 6, 6)}
            </p>
          )}
          {desc ? (
            <p className="mt-2 line-clamp-2 text-[11px] leading-snug text-slate-400">{desc}</p>
          ) : null}
          <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-slate-500">
            <UserIcon className="h-3 w-3" /> by{" "}
            <code className="text-slate-400">{shortPk(auction.authority.toBase58())}</code>
          </p>
        </div>
        <div
          className="text-right"
          title="Increments after Arcium MXE finalizes each sealed bid (short delay past wallet confirmation)."
        >
          <div className="text-[10px] uppercase tracking-widest text-slate-500">
            bids on-chain
          </div>
          <div className="font-mono text-2xl text-violet-100">{auction.bidCount}</div>
        </div>
      </div>

      {revealed ? (
        <div className="relative mt-4 rounded-xl border border-amber-400/30 bg-amber-500/5 p-3">
          <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-amber-200">
            <Crown className="h-3 w-3" /> winner
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <code className="truncate font-mono text-xs text-amber-100">
              {shortPk(auction.winner.toBase58(), 6, 6)}
            </code>
            <span className="font-mono text-base text-fuchsia-100">
              {lamportsToSolDisplayWithSuffix(auction.winningBid)}
            </span>
          </div>
        </div>
      ) : (
        <div className="relative mt-4 rounded-xl border border-white/[0.06] bg-black/35 p-3 text-[11px] text-slate-500">
          Bid amounts are encrypted on-chain. Only the seller can call{" "}
          <code className="text-slate-400">reveal_winner</code>.
        </div>
      )}

      <Link
        href={`/auctions/${pdaB58}`}
        className={`relative mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
          revealed
            ? "border-amber-400/40 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20"
            : showCta
              ? "border-violet-400/40 bg-violet-500/10 text-violet-100 hover:bg-violet-500/20"
              : "border-white/15 bg-white/5 text-slate-200 hover:bg-white/10"
        }`}
      >
        {revealed ? "View winner" : "Open auction"}
      </Link>
    </motion.div>
  );
}
