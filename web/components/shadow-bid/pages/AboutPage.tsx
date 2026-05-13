"use client";

import { AppShell, PageHero } from "@/components/shadow-bid/AppShell";
import { CiphertextRain } from "@/components/shadow-bid/CiphertextRain";
import { motion } from "framer-motion";
import {
  ArrowRight,
  EyeOff,
  Gavel,
  KeyRound,
  Lock,
  ShieldOff,
  Sparkles,
  Trophy,
} from "lucide-react";
import Link from "next/link";

const STEPS = [
  {
    n: 1,
    icon: KeyRound,
    title: "Encrypt locally",
    body:
      "Your browser generates an ephemeral X25519 keypair, performs ECDH with the MXE's public key, and feeds the shared secret into RescueCipher. The plaintext bid never leaves your machine.",
  },
  {
    n: 2,
    icon: Lock,
    title: "Submit ciphertext to Solana",
    body:
      "place_bid sends only ciphertexts + nonces. Solana validators (and the entire mempool) cannot read the amount. MEV bots have nothing to sandwich.",
  },
  {
    n: 3,
    icon: ShieldOff,
    title: "Compare inside the MXE",
    body:
      "An Arcium multi-party compute cluster runs the place_bid Arcis circuit on encrypted inputs and updates the MXE-encrypted AuctionState. Even the Arx node operators see nothing.",
  },
  {
    n: 4,
    icon: Trophy,
    title: "Reveal exactly one number",
    body:
      "When the seller calls reveal_winner, the MXE decrypts only the winning amount + bidder. Losing amounts are sealed forever.",
  },
];

const FAQ = [
  {
    q: "Can the MXE operators see my bid?",
    a: "No. The MPC protocol guarantees no single Arx node ever holds plaintext; bids are computed under encryption inside the cluster.",
  },
  {
    q: "What stops me from being front-run?",
    a: "The mempool sees ciphertext + a random nonce. There is no readable amount for searchers to sandwich. After reveal, the auction is already over.",
  },
  {
    q: "What's stored on Solana?",
    a: "Each Auction PDA holds a 96-byte encrypted state (a u64 + two u128 limbs that encode a Pubkey), a state nonce, the bid count, and — once revealed — the winner + winning bid in cleartext.",
  },
  {
    q: "Why is there a per-bid Arcium computation account?",
    a: "Every queued MXE computation gets its own Solana account so the cluster can post the verified output. After finalization you can reclaim its rent from your dashboard.",
  },
  {
    q: "Are losing bidders refunded automatically?",
    a: "Not yet — escrow + auto-refund is on the roadmap. Today the auction is informational; the seller settles off-chain or via a follow-up program.",
  },
];

export function AboutPage() {
  return (
    <AppShell>
      <PageHero
        eyebrow="Cryptography"
        title="How a sealed-bid auction stays sealed"
        subtitle="ShadowBid runs on Arcium's encrypted computation. Here's the exact path your bid takes — and what nobody can see along the way."
      />

      {/* Pipeline */}
      <section className="mx-auto mt-10 grid w-full max-w-[1400px] gap-6 px-4 pb-6 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:px-8">
        <div className="flex flex-col gap-4">
          {STEPS.map((s) => (
            <motion.div
              key={s.n}
              initial={{ opacity: 0, x: -8 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, amount: 0.6 }}
              transition={{ duration: 0.4 }}
              className="flex gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4 backdrop-blur-md"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-400/40 bg-violet-500/10 text-violet-200">
                <s.icon className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">
                  Step {s.n}
                </div>
                <h3 className="mt-1 text-base font-semibold text-white">{s.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-400">{s.body}</p>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="flex flex-col gap-4">
          <div className="relative scanline rounded-2xl border border-violet-400/25 bg-black/45 p-4 backdrop-blur-md">
            <div className="mb-3 flex items-center justify-between">
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.22em] text-violet-300/85">
                <Sparkles className="h-3 w-3" /> what nobody sees
              </span>
              <span className="rounded-md border border-fuchsia-400/35 bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-fuchsia-200">
                ciphertext
              </span>
            </div>
            <CiphertextRain cols={26} rows={8} />
            <p className="mt-3 text-[11px] text-slate-500">
              That row above is what a validator, an Arx node, an indexer, or your nosy
              neighbor sees when they read the auction account.
            </p>
          </div>

          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5">
            <h3 className="text-sm font-semibold text-violet-200/95">Threat model</h3>
            <ul className="mt-3 space-y-2 text-xs text-slate-400">
              <li className="flex gap-2">
                <EyeOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300" />
                <span>
                  Other bidders see only the public bid count + the same ciphertext you
                  see.
                </span>
              </li>
              <li className="flex gap-2">
                <ShieldOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300" />
                <span>
                  MEV bots can't read the amount in flight, so there's nothing to
                  sandwich.
                </span>
              </li>
              <li className="flex gap-2">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300" />
                <span>
                  The seller can call reveal_winner — but only the winning amount + bidder
                  are decrypted; losers stay sealed forever.
                </span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto w-full max-w-[1400px] px-4 py-10 sm:px-6 lg:px-8">
        <h2 className="text-2xl font-bold text-white">FAQ</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {FAQ.map((f) => (
            <details
              key={f.q}
              className="group rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4 open:bg-white/[0.05]"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-white">
                {f.q}
                <ArrowRight className="h-4 w-4 text-slate-500 transition-transform group-open:rotate-90" />
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto w-full max-w-[1400px] px-4 pb-14 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-3xl border border-violet-400/30 bg-[linear-gradient(135deg,rgba(76,29,149,0.45)_0%,rgba(192,38,211,0.25)_100%)] p-8 text-center">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">Try it now</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-200">
            Spin up an auction in one click, share the PDA, watch sealed bids stack
            against each other, then dramatically reveal the winner.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Link
              href="/auctions"
              className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/15"
            >
              <Gavel className="h-4 w-4" /> Browse auctions
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-full border border-violet-400/40 bg-gradient-to-r from-violet-600 via-fuchsia-600 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_0_28px_rgba(192,38,211,0.45)]"
            >
              Open my dashboard
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
