"use client";

import { useShadowBid } from "@/components/shadow-bid/ShadowBidContext";
import { isDevnetRpc, isLocalSolanaRpc } from "@/lib/solana/cluster";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Gavel,
  Github,
  LayoutDashboard,
  Loader2,
  Radio,
  RefreshCw,
  Shield,
  Sparkles,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

function truncateMid(s: string, a = 4, b = 4) {
  if (s.length <= a + b + 1) return s;
  return `${s.slice(0, a)}…${s.slice(-b)}`;
}

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

const NAV: { href: string; label: string; icon: typeof Gavel }[] = [
  { href: "/", label: "Home", icon: Sparkles },
  { href: "/auctions", label: "Auctions", icon: Gavel },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/about", label: "How it works", icon: BookOpen },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const {
    connected,
    connecting,
    publicKey,
    openWalletModal,
    disconnect,
    rpcReachable,
    rpcEndpoint,
    syncing,
    syncChain,
    feed,
    clearFeed,
    solBalance,
    clusterOffset,
  } = useShadowBid();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname?.startsWith(href);

  const isLocalLikeRpc = isLocalSolanaRpc(rpcEndpoint);
  const lowSolBanner =
    connected &&
    rpcReachable === true &&
    solBalance !== null &&
    solBalance < 0.05 &&
    (isLocalLikeRpc || isDevnetRpc(rpcEndpoint));

  return (
    <div className="relative flex min-h-screen flex-col">
      {/* Top RPC banner — calm, only when offline */}
      {rpcReachable === false ? (
        <div className="border-b border-amber-500/25 bg-amber-950/40 px-4 py-1.5 text-center text-[11px] text-amber-200">
          RPC unreachable at <code className="rounded bg-black/40 px-1">{rpcEndpoint}</code>
          {" "}— on-chain actions are disabled until connectivity returns.
        </div>
      ) : null}
      {lowSolBanner && publicKey ? (
        <div className="border-b border-violet-500/30 bg-violet-950/35 px-4 py-2 text-center text-[11px] leading-snug text-violet-100/95">
          {isDevnetRpc(rpcEndpoint) ? (
            <>
              <span className="font-medium text-violet-200">Low balance:</span> fund this wallet on devnet via{" "}
              <a
                href="https://faucet.solana.com"
                target="_blank"
                rel="noreferrer"
                className="text-violet-300 underline underline-offset-2 hover:text-white"
              >
                faucet.solana.com
              </a>
              .
            </>
          ) : (
            <>
              <span className="font-medium text-violet-200">Low balance:</span> this wallet needs SOL for fees and rent.
              <code className="mt-1 block break-all rounded bg-black/45 px-2 py-1 font-mono text-[10px] text-violet-100/90 sm:mt-0 sm:inline sm:px-1">
                solana airdrop 5 {publicKey.toBase58()} --url {rpcEndpoint}
              </code>
            </>
          )}
        </div>
      ) : null}

      {/* NAVBAR */}
      <header className="sticky top-0 z-40 glass-navbar">
        <div className="mx-auto flex h-16 w-full max-w-[1400px] items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5 group">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-violet-500/40 bg-gradient-to-br from-violet-600/30 to-fuchsia-600/15 shadow-neon ring-1 ring-white/10 group-hover:scale-105 transition-transform">
              <Gavel className="h-4.5 w-4.5 text-violet-200 drop-shadow-[0_0_8px_rgba(167,139,250,0.8)]" />
            </span>
            <span className="text-lg font-semibold tracking-tight text-white">
              ShadowBid<span className="text-violet-400/90">.</span>
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="ml-6 hidden items-center gap-0.5 lg:flex">
            {NAV.map((n) => {
              const active = isActive(n.href);
              const Icon = n.icon;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? "bg-white/10 text-white"
                      : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {n.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {/* RPC pill */}
            <span
              title={rpcEndpoint}
              className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium md:inline-flex ${
                rpcReachable === true
                  ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
                  : rpcReachable === false
                    ? "border-amber-500/35 bg-amber-500/10 text-amber-200"
                    : "border-white/15 bg-white/5 text-slate-400"
              }`}
            >
              {rpcReachable === true ? (
                <Check className="h-3 w-3" />
              ) : (
                <Radio className="h-3 w-3 opacity-70" />
              )}
              {rpcReachable === true ? "RPC" : rpcReachable === false ? "offline" : "…"}
            </span>

            {connected && solBalance !== null ? (
              <span className="hidden font-mono text-[11px] text-slate-400 md:inline">
                <span className="text-violet-200">{solBalance.toFixed(3)}</span> SOL
              </span>
            ) : null}

            <button
              type="button"
              onClick={() => void syncChain()}
              disabled={syncing}
              title="Re-ping RPC + refetch MXE key"
              className="hidden h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 disabled:opacity-50 sm:inline-flex"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
            </button>

            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              title="Open activity"
              className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
            >
              <Activity className="h-3.5 w-3.5" />
              {feed.length > 0 ? (
                <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full border border-violet-400/40 bg-violet-500/30 px-1 text-[10px] font-bold text-violet-100">
                  {feed.length > 99 ? "99+" : feed.length}
                </span>
              ) : null}
            </button>

            {connected && publicKey ? (
              <button
                type="button"
                onClick={() => disconnect()}
                title={publicKey.toBase58()}
                className="hidden rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 font-mono text-[11px] text-slate-200 hover:bg-white/10 sm:inline-flex"
              >
                {truncateMid(publicKey.toBase58())}
              </button>
            ) : (
              <motion.button
                type="button"
                onClick={openWalletModal}
                disabled={connecting}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/40 bg-gradient-to-r from-violet-600/90 via-fuchsia-600/80 to-indigo-600/90 px-4 py-1.5 text-xs font-semibold text-white shadow-[0_0_18px_rgba(139,92,246,0.45)] disabled:opacity-60"
              >
                {connecting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wallet className="h-3.5 w-3.5" />
                )}
                {connecting ? "Connecting…" : "Connect"}
              </motion.button>
            )}

            {/* Hamburger (mobile) */}
            <button
              type="button"
              onClick={() => setMobileNavOpen((v) => !v)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-300 lg:hidden"
            >
              <ChevronDown
                className={`h-4 w-4 transition-transform ${mobileNavOpen ? "rotate-180" : ""}`}
              />
            </button>
          </div>
        </div>

        {/* Mobile nav drawer */}
        <AnimatePresence>
          {mobileNavOpen ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-t border-white/5 bg-black/50 backdrop-blur-xl lg:hidden"
            >
              <nav className="mx-auto flex max-w-[1400px] flex-col gap-1 px-4 py-3 sm:px-6">
                {NAV.map((n) => {
                  const active = isActive(n.href);
                  const Icon = n.icon;
                  return (
                    <Link
                      key={n.href}
                      href={n.href}
                      className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                        active
                          ? "bg-white/10 text-white"
                          : "text-slate-300 hover:bg-white/5"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {n.label}
                    </Link>
                  );
                })}
                <div className="mt-2 flex items-center gap-2 border-t border-white/5 pt-3 text-[11px] text-slate-500">
                  <span>cluster offset {clusterOffset}</span>
                  <span>·</span>
                  <code className="truncate font-mono text-slate-400">{rpcEndpoint}</code>
                </div>
              </nav>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </header>

      {/* MAIN */}
      <main className="relative flex-1">{children}</main>

      {/* FOOTER */}
      <footer className="relative z-10 mt-12 border-t border-white/5 py-6">
        <div className="mx-auto flex max-w-[1400px] flex-col items-center justify-between gap-2 px-4 text-[11px] text-slate-500 sm:flex-row sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <Shield className="h-3.5 w-3.5 text-violet-300/60" />
            <span>
              ShadowBid · Arcium MXE sealed-bid auctions · cluster offset {clusterOffset}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/about" className="hover:text-slate-300">How it works</Link>
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-slate-300"
            >
              <Github className="h-3 w-3" /> source
            </a>
          </div>
        </div>
      </footer>

      {/* Activity drawer */}
      <AnimatePresence>
        {drawerOpen ? (
          <motion.div
            key="drawer-back"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
          >
            <motion.aside
              key="drawer"
              onClick={(e) => e.stopPropagation()}
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 36 }}
              className="absolute right-0 top-0 h-full w-full max-w-md border-l border-white/10 bg-[linear-gradient(180deg,rgba(15,8,40,0.97)_0%,rgba(5,2,14,0.97)_100%)] shadow-[0_0_60px_rgba(0,0,0,0.6)]"
            >
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/20 text-violet-200">
                    <Activity className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">Activity</h3>
                    <p className="text-[10px] uppercase tracking-widest text-slate-500">
                      Successes · errors (no RPC spam)
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={clearFeed}
                    title="Clear"
                    className="rounded-lg border border-white/10 p-1.5 text-slate-400 hover:bg-white/10 hover:text-rose-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    className="rounded-lg border border-white/10 p-1.5 text-slate-300 hover:bg-white/10"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <ul className="space-y-2 overflow-y-auto px-4 py-4 max-h-[calc(100vh-72px)]">
                {feed.length === 0 ? (
                  <li className="px-2 py-12 text-center text-sm text-slate-500">
                    No activity yet. Successful actions will land here.
                  </li>
                ) : (
                  feed.map((row) => (
                    <li
                      key={row.id}
                      className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 text-sm"
                    >
                      <p className="text-slate-100 leading-snug">{row.msg}</p>
                      <p className="mt-1.5 text-[11px] text-slate-500" suppressHydrationWarning>
                        {timeAgo(row.ts)}
                      </p>
                    </li>
                  ))
                )}
              </ul>
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function PageHero({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pt-8 sm:px-6 lg:px-8 lg:pt-12">
      <div className="flex flex-col items-start gap-4">
        {eyebrow ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-white/[0.04] px-3 py-1 text-[10px] font-medium uppercase tracking-[0.22em] text-violet-300/90">
            <Sparkles className="h-3 w-3" />
            {eyebrow}
          </span>
        ) : null}
        <h1 className="text-3xl font-bold leading-[1.05] tracking-tight text-white sm:text-4xl md:text-5xl text-glow">
          {title}
        </h1>
        {subtitle ? (
          <p className="max-w-3xl text-sm text-slate-400 sm:text-base">{subtitle}</p>
        ) : null}
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function NavCrumb({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-[11px] uppercase tracking-widest text-slate-500 hover:text-violet-300"
    >
      <ChevronRight className="h-3 w-3 rotate-180" />
      {label}
    </Link>
  );
}
