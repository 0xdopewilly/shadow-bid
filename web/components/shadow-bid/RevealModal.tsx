"use client";

import { lamportsToSolDisplayWithSuffix } from "@/lib/shadow-bid/lamportsDisplay";
import { AnimatePresence, motion } from "framer-motion";
import { Crown, Loader2, Lock, Sparkles, Trophy, X } from "lucide-react";
import { useEffect, useMemo } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Auction PDA (base58). */
  auctionPda: string | null;
  /** On-chain public bid count at reveal time. */
  bidCount: number | null;
  /** The user's locally-known highest bid lamports (for "you bid X" line). */
  myHighestLamports: bigint | null;
  /** True if the connected wallet is the auction authority. */
  isAuthority: boolean;
  /** Whether the on-chain reveal has run. */
  revealed: boolean;
  /** When `revealed` is true, the winner pubkey base58. */
  winnerB58: string | null;
  /** When `revealed` is true, the winning bid in lamports as string. */
  winningBidLamports: string | null;
  /** Auth-only: trigger the on-chain reveal_winner Arcium computation. */
  onTriggerReveal?: () => void;
  /** True while the on-chain reveal call is in flight. */
  triggering?: boolean;
  /** Whether MXE is ready (so the trigger button can enable). */
  mxeReady?: boolean;
  /** True when NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET is 0 against a hosted RPC (almost always wrong vs deploy `-o`). */
  arciumClusterMisconfigured?: boolean;
}

function shortPk(b58: string): string {
  if (b58.length <= 12) return b58;
  return `${b58.slice(0, 6)}…${b58.slice(-6)}`;
}

const SHARDS = 18;

/**
 * Summary modal after auction close: public bid count, optional local bid note,
 * and authority controls to run on-chain reveal when applicable.
 */
export function RevealModal({
  open,
  onClose,
  auctionPda,
  bidCount,
  myHighestLamports,
  isAuthority,
  revealed,
  winnerB58,
  winningBidLamports,
  onTriggerReveal,
  triggering,
  mxeReady = true,
  arciumClusterMisconfigured = false,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const shards = useMemo(
    () =>
      Array.from({ length: SHARDS }, (_, i) => ({
        id: i,
        x: (Math.random() - 0.5) * 800,
        y: (Math.random() - 0.5) * 600,
        rot: (Math.random() - 0.5) * 720,
        scale: 0.6 + Math.random() * 1.2,
        delay: Math.random() * 0.15,
        clip: `polygon(${50 + (Math.random() - 0.5) * 30}% 0%, 100% ${
          30 + Math.random() * 40
        }%, ${50 + (Math.random() - 0.5) * 40}% 100%, 0% ${
          30 + Math.random() * 40
        }%)`,
      })),
    [open]
  );

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="reveal-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 px-4 backdrop-blur-md"
          onClick={onClose}
        >
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {shards.map((s) => (
              <motion.div
                key={s.id}
                initial={{ x: 0, y: 0, rotate: 0, opacity: 0.85, scale: 1 }}
                animate={{
                  x: s.x,
                  y: s.y,
                  rotate: s.rot,
                  opacity: 0,
                  scale: s.scale,
                }}
                transition={{
                  duration: 1.4,
                  delay: s.delay,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 border border-fuchsia-300/40 bg-gradient-to-br from-violet-500/30 via-fuchsia-500/30 to-indigo-500/30 mix-blend-screen"
                style={{ clipPath: s.clip }}
              />
            ))}
          </div>

          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 24, scale: 0.94, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 16, scale: 0.96, opacity: 0 }}
            transition={{ delay: 0.18, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 w-full max-w-lg overflow-hidden rounded-3xl border border-violet-400/40 bg-[linear-gradient(160deg,rgba(15,8,40,0.95)_0%,rgba(35,10,60,0.92)_60%,rgba(70,12,100,0.88)_100%)] p-6 sm:p-8 shadow-[0_0_80px_rgba(192,38,211,0.45)]"
          >
            <button
              type="button"
              onClick={onClose}
              className="absolute right-3 top-3 rounded-full border border-white/15 bg-black/40 p-1.5 text-slate-300 hover:bg-white/10"
            >
              <X className="h-4 w-4" />
            </button>

            <motion.div
              initial={{ y: 12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.35, duration: 0.5 }}
              className="mb-5 inline-flex items-center gap-2 rounded-full border border-fuchsia-400/40 bg-fuchsia-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-fuchsia-200"
            >
              <Sparkles className="h-3 w-3" />
              Auction reveal
            </motion.div>

            <motion.h3
              initial={{ y: 12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.42, duration: 0.55 }}
              className="text-3xl font-bold leading-tight text-white text-glow"
            >
              {revealed ? "The veil shatters." : "Sealed — for now."}
            </motion.h3>

            {arciumClusterMisconfigured ? (
              <motion.p
                initial={{ y: 8, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.46, duration: 0.45 }}
                className="mt-3 rounded-xl border border-amber-400/40 bg-amber-500/15 px-3 py-2 text-[11px] leading-snug text-amber-50/95"
              >
                <strong className="font-semibold text-amber-100">Misconfiguration:</strong> this build uses{" "}
                <code className="rounded bg-black/40 px-1">NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET=0</code> against a hosted RPC —
                MXC PDAs won&apos;t match <code className="font-mono">arcium deploy -o …</code>. Align env (e.g.{" "}
                <span className="font-mono">456</span>) and redeploy the site.
              </motion.p>
            ) : null}

            <motion.p
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.5 }}
              className="mt-2 text-sm text-slate-300/90"
            >
              {revealed
                ? "Losing bids stay sealed forever. Only the winner is unmasked."
                : "Losing bids will stay sealed forever. Only the winner is ever unmasked."}
            </motion.p>

            {revealed ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.55, type: "spring", stiffness: 280, damping: 20 }}
                className="mt-5 rounded-2xl border border-amber-400/40 bg-gradient-to-br from-amber-500/15 via-fuchsia-500/10 to-violet-600/15 p-4 shadow-[0_0_32px_rgba(251,191,36,0.25)]"
              >
                <div className="flex items-center gap-2 text-amber-200/95">
                  <Trophy className="h-4 w-4" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.22em]">
                    Winner
                  </span>
                </div>
                <div className="mt-1 font-mono text-base text-white break-all">
                  {winnerB58 ? shortPk(winnerB58) : "—"}
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 text-sm">
                  <span className="text-slate-400">Winning bid</span>
                  <span className="font-mono text-lg text-fuchsia-100">
                    {winningBidLamports != null
                      ? lamportsToSolDisplayWithSuffix(winningBidLamports)
                      : "— SOL"}
                  </span>
                </div>
              </motion.div>
            ) : null}

            <div className="mt-5 grid gap-2 text-sm">
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.6 }}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-black/40 px-3 py-2"
              >
                <span className="text-slate-400">Confirmed sealed bids</span>
                <span className="font-mono text-violet-200">
                  {bidCount ?? "—"}
                </span>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.7 }}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-black/40 px-3 py-2"
              >
                <span className="text-slate-400">Your highest sealed bid</span>
                <span className="font-mono text-fuchsia-200">
                  {myHighestLamports != null
                    ? lamportsToSolDisplayWithSuffix(myHighestLamports)
                    : "none on this device"}
                </span>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.8 }}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-black/40 px-3 py-2"
              >
                <span className="text-slate-400">Auction PDA</span>
                <span className="font-mono text-xs text-slate-300">
                  {auctionPda ? shortPk(auctionPda) : "—"}
                </span>
              </motion.div>
            </div>

            <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
              Count stays at <span className="font-mono text-slate-400">0</span> until the first bid&apos;s
              MXE computation finishes — not when the wallet-only transaction lands.
            </p>

            {!revealed && isAuthority && onTriggerReveal ? (
              <motion.button
                type="button"
                disabled={triggering || !mxeReady}
                onClick={onTriggerReveal}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.95 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-amber-400/45 bg-gradient-to-r from-amber-500/30 via-fuchsia-500/30 to-violet-500/30 py-2.5 text-sm font-semibold text-white shadow-[0_0_36px_rgba(251,191,36,0.35)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {triggering ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Decrypting on-chain…
                  </>
                ) : (
                  <>
                    <Crown className="h-4 w-4" />
                    Trigger on-chain reveal_winner
                  </>
                )}
              </motion.button>
            ) : !revealed ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.95 }}
                className="mt-5 flex items-start gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[12px] text-slate-400"
              >
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" />
                <span>
                  Only the auction <span className="text-violet-200">authority</span>
                  {" "}can call <code className="rounded bg-black/50 px-1 text-slate-200">reveal_winner</code>.
                </span>
              </motion.div>
            ) : null}

            <button
              type="button"
              onClick={onClose}
              className="mt-4 w-full rounded-xl border border-violet-400/40 bg-gradient-to-r from-violet-600/90 via-fuchsia-600/85 to-indigo-600/90 py-2.5 text-sm font-semibold text-white shadow-[0_0_36px_rgba(192,38,211,0.45)] hover:brightness-110"
            >
              Close
            </button>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
