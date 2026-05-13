"use client";

import { AppShell, PageHero } from "@/components/shadow-bid/AppShell";
import { AuctionCard } from "@/components/shadow-bid/AuctionCard";
import { useShadowBid } from "@/components/shadow-bid/ShadowBidContext";
import type { AuctionListEntry } from "@/lib/shadow-bid/flows";
import {
  createAuctionFlow,
  pickUnusedListingIndex,
  listingImageSrc,
  setAuctionDeadlineFlow,
} from "@/lib/shadow-bid/flows";
import { isLocalSolanaRpc } from "@/lib/solana/cluster";
import { AnimatePresence, motion } from "framer-motion";
import {
  Filter,
  Loader2,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Timer,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type AuctionFilter = "all" | "live" | "revealed" | "mine";
/** Browse sort: bid count is the on-chain proxy for hottest auctions (no per-bid timestamp in this list). */
type SortMode = "most_bids" | "ending_soon";

function compareMostBids(a: AuctionListEntry, b: AuctionListEntry): number {
  if (a.revealed !== b.revealed) return a.revealed ? 1 : -1;
  return b.bidCount - a.bidCount;
}

function compareEndingSoon(
  a: AuctionListEntry,
  b: AuctionListEntry,
  nowSec: number
): number {
  const tier = (x: AuctionListEntry): number => {
    if (x.revealed) return 3;
    if (x.biddingEndsAt > nowSec) return 0;
    if (x.biddingEndsAt > 0) return 1;
    return 2;
  };
  const ta = tier(a);
  const tb = tier(b);
  if (ta !== tb) return ta - tb;
  if (ta === 0) {
    if (a.biddingEndsAt !== b.biddingEndsAt)
      return a.biddingEndsAt - b.biddingEndsAt;
    return b.bidCount - a.bidCount;
  }
  if (ta === 1) {
    if (a.biddingEndsAt !== b.biddingEndsAt)
      return b.biddingEndsAt - a.biddingEndsAt;
    return b.bidCount - a.bidCount;
  }
  if (ta === 2) return b.bidCount - a.bidCount;
  return b.bidCount - a.bidCount;
}

export function AuctionsPage() {
  const router = useRouter();
  const {
    program,
    provider,
    publicKey,
    walletPk,
    connected,
    rpcReachable,
    rpcEndpoint,
    clusterOffset,
    allAuctions,
    auctionsLoading,
    refreshAllAuctions,
    initBusy,
    initAllCircuits,
    pushFeed,
    pushToast,
    reportError,
    openWalletModal,
  } = useShadowBid();

  const [filter, setFilter] = useState<AuctionFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("most_bids");
  const [sortNowSec, setSortNowSec] = useState(() =>
    Math.floor(Date.now() / 1000)
  );
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftImageUri, setDraftImageUri] = useState("");
  const [lockDeadlineOnCreate, setLockDeadlineOnCreate] = useState(false);
  const [createDeadlineMinutes, setCreateDeadlineMinutes] = useState(60);

  useEffect(() => {
    if (sortMode !== "ending_soon") return;
    setSortNowSec(Math.floor(Date.now() / 1000));
    const id = setInterval(
      () => setSortNowSec(Math.floor(Date.now() / 1000)),
      30_000
    );
    return () => clearInterval(id);
  }, [sortMode]);

  const filtered = useMemo(() => {
    let list = allAuctions;
    if (filter === "live") list = list.filter((a) => !a.revealed);
    else if (filter === "revealed") list = list.filter((a) => a.revealed);
    else if (filter === "mine")
      list = list.filter((a) => walletPk && a.authority.toBase58() === walletPk);

    const q = query.trim().toLowerCase();
    if (q)
      list = list.filter(
        (a) =>
          a.pda.toBase58().toLowerCase().includes(q) ||
          a.authority.toBase58().toLowerCase().includes(q) ||
          (a.revealed && a.winner.toBase58().toLowerCase().includes(q)) ||
          (a.title && a.title.toLowerCase().includes(q)) ||
          (a.description && a.description.toLowerCase().includes(q)) ||
          (a.imageUri && a.imageUri.toLowerCase().includes(q))
      );

    return [...list].sort((a, b) =>
      sortMode === "ending_soon"
        ? compareEndingSoon(a, b, sortNowSec)
        : compareMostBids(a, b)
    );
  }, [
    allAuctions,
    filter,
    query,
    walletPk,
    sortMode,
    sortNowSec,
  ]);

  const sellerListingCount = useMemo(
    () =>
      walletPk
        ? allAuctions.filter((a) => a.authority.toBase58() === walletPk).length
        : 0,
    [allAuctions, walletPk]
  );

  const nextListingIndex = useMemo(() => {
    if (!publicKey || !program) return null;
    const minePdAs = allAuctions
      .filter((a) => a.authority.toBase58() === publicKey.toBase58())
      .map((a) => a.pda);
    return pickUnusedListingIndex(program.programId, publicKey, minePdAs);
  }, [publicKey, program, allAuctions]);

  const submitCreate = useCallback(async () => {
    if (!program || !provider || !publicKey)
      throw new Error("Connect wallet first");
    const trimmedImg = draftImageUri.trim();
    if (trimmedImg && !listingImageSrc(trimmedImg)) {
      pushToast({
        kind: "warn",
        title: "Invalid image link",
        body: "Use https://, http:// (local only), or ipfs://…",
      });
      return;
    }
    setCreating(true);
    try {
      if (nextListingIndex === null) {
        pushToast({
          kind: "warn",
          title: "Too many auctions",
          body: "This wallet exhausted the scanned listing-index range — contact support.",
        });
        return;
      }
      const { auction } = await createAuctionFlow(
        program,
        provider,
        clusterOffset,
        publicKey,
        {
          listingId: nextListingIndex,
          title: draftTitle,
          description: draftDescription,
          imageUri: trimmedImg,
        }
      );
      pushFeed(`Auction live · ${auction.toBase58().slice(0, 6)}…`, true);

      if (lockDeadlineOnCreate && createDeadlineMinutes >= 5) {
        const unixSec = Math.floor(
          (Date.now() + createDeadlineMinutes * 60_000) / 1000
        );
        const sig = await setAuctionDeadlineFlow(
          program,
          publicKey,
          auction,
          unixSec
        );
        pushFeed(`Deadline locked · tx ${sig.slice(0, 6)}…${sig.slice(-6)}`, true);
        pushToast({
          kind: "info",
          title: "Deadline locked",
          body: "Bidding window is now immutable on-chain.",
        });
      }

      pushToast({
        kind: "info",
        title: "Auction created",
        body: lockDeadlineOnCreate
          ? "Listing is live with a sealed-bidding window."
          : "Listing is live. You can still lock a deadline from the auction page.",
      });
      setCreateOpen(false);
      setDraftTitle("");
      setDraftDescription("");
      setDraftImageUri("");
      setLockDeadlineOnCreate(false);
      setCreateDeadlineMinutes(60);
      await refreshAllAuctions();
      router.push(`/auctions/${auction.toBase58()}`);
    } finally {
      setCreating(false);
    }
  }, [
    nextListingIndex,
    program,
    provider,
    publicKey,
    clusterOffset,
    draftTitle,
    draftDescription,
    draftImageUri,
    lockDeadlineOnCreate,
    createDeadlineMinutes,
    pushFeed,
    pushToast,
    refreshAllAuctions,
    router,
  ]);

  const showLocalOperatorUi = isLocalSolanaRpc(rpcEndpoint);

  return (
    <AppShell>
      <PageHero
        eyebrow="Marketplace"
        title="Auctions"
        subtitle="All users share the same RPC and program deployment; auction accounts and listing text are read from chain."
        actions={
          <>
            {connected ? (
              <motion.button
                type="button"
                onClick={() => setCreateOpen(true)}
                disabled={
                  creating ||
                  !program ||
                  rpcReachable === false ||
                  nextListingIndex === null
                }
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="inline-flex items-center gap-2 rounded-full border border-violet-400/40 bg-gradient-to-r from-violet-600 via-fuchsia-600 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_0_28px_rgba(192,38,211,0.45)] disabled:opacity-50"
                title={
                  nextListingIndex === null && program && rpcReachable !== false
                    ? "No free listing slots in the scanned index range."
                    : undefined
                }
              >
                {creating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                Create new auction
              </motion.button>
            ) : (
              <button
                type="button"
                onClick={openWalletModal}
                className="inline-flex items-center gap-2 rounded-full border border-violet-400/40 bg-gradient-to-r from-violet-600 via-fuchsia-600 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_0_28px_rgba(192,38,211,0.45)]"
              >
                <Zap className="h-4 w-4" /> Connect to create
              </button>
            )}
            {showLocalOperatorUi ? (
              <button
                type="button"
                onClick={() => void initAllCircuits().catch(reportError)}
                disabled={initBusy || !connected || rpcReachable === false}
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-xs font-medium text-slate-200 hover:bg-white/10 disabled:opacity-50"
                title="Initialize MXE circuit definitions (local validator only)"
              >
                {initBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {initBusy ? "Installing circuits…" : "Init MXE circuits"}
              </button>
            ) : null}
          </>
        }
      />

      {showLocalOperatorUi ? (
        <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8">
          <p className="mb-4 rounded-xl border border-amber-500/25 bg-amber-950/25 px-4 py-3 text-[12px] leading-relaxed text-amber-100/90">
            <span className="font-semibold text-amber-200">Local validator:</span>{" "}
            <strong className="text-white">Init MXE circuits</strong> must be signed by the MXE authority
            keypair (typically <code className="rounded bg-black/40 px-1">~/.config/solana/id.json</code>).
            If the browser wallet returns <code className="text-slate-300">InvalidAuthority</code>, run{" "}
            <code className="rounded bg-black/40 px-1 text-slate-200">yarn init:mxe-circuits</code> from the
            repository root, then use the browser wallet for create, bid, and reveal.
          </p>
        </div>
      ) : null}

      <div className="mx-auto mt-8 w-full max-w-[1400px] px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3 backdrop-blur-md">
          <div className="relative flex flex-1 min-w-[220px] items-center">
            <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title, details, PDA, authority…"
              className="w-full rounded-lg border border-white/10 bg-black/30 py-1.5 pl-8 pr-3 text-sm text-white outline-none input-glow placeholder:text-slate-600"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1 rounded-lg border border-white/10 bg-black/30 p-1 text-xs">
            {(["all", "live", "revealed", "mine"] as AuctionFilter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                disabled={f === "mine" && !walletPk}
                className={`rounded-md px-2.5 py-1 capitalize transition-colors ${
                  filter === f
                    ? "bg-violet-500/20 text-violet-100"
                    : "text-slate-400 hover:text-slate-200 disabled:opacity-40"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <div
            className="flex items-center gap-0.5 rounded-lg border border-white/10 bg-black/30 p-1 text-[11px]"
            title="Most bids uses on-chain bid count (no per-bid timestamp in this list). Ending soon uses each auction’s locked deadline."
          >
            <button
              type="button"
              onClick={() => setSortMode("most_bids")}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 transition-colors ${
                sortMode === "most_bids"
                  ? "bg-fuchsia-500/20 text-fuchsia-100"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <TrendingUp className="h-3 w-3 opacity-80" />
              Most bids
            </button>
            <button
              type="button"
              onClick={() => setSortMode("ending_soon")}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 transition-colors ${
                sortMode === "ending_soon"
                  ? "bg-fuchsia-500/20 text-fuchsia-100"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Timer className="h-3 w-3 opacity-80" />
              Ending soon
            </button>
          </div>
          <button
            type="button"
            onClick={() => void refreshAllAuctions()}
            disabled={auctionsLoading}
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${auctionsLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      <section className="mx-auto w-full max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
        <p className="mb-6 flex items-start gap-2 text-[12px] leading-relaxed text-slate-500 sm:items-center">
          <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-400/80 sm:mt-0" />
          <span>
            Titles, descriptions, and optional image links are public on-chain so anyone on this cluster
            can discover the sale; sealed bid amounts stay encrypted until the seller reveals the winner.
            Sellers can share an auction&apos;s page URL so others can bid from their own wallets.
          </span>
        </p>
        {filtered.length === 0 ? (
          <EmptyState
            connected={connected}
            hasMine={sellerListingCount > 0}
            filter={filter}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((a) => (
              <AuctionCard
                key={a.pda.toBase58()}
                auction={a}
                isMine={walletPk === a.authority.toBase58()}
              />
            ))}
          </div>
        )}
      </section>

      <AnimatePresence>
        {createOpen ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={() => !creating && setCreateOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-lg rounded-2xl border border-violet-500/30 bg-[linear-gradient(180deg,rgba(20,12,45,0.98)_0%,rgba(8,4,18,0.98)_100%)] p-6 shadow-[0_0_60px_rgba(99,102,241,0.25)]"
            >
              <button
                type="button"
                disabled={creating}
                onClick={() => setCreateOpen(false)}
                className="absolute right-4 top-4 rounded-lg p-1 text-slate-500 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
              <h2 className="text-lg font-semibold text-white">New sealed auction</h2>
              <p className="mt-1 text-xs text-slate-400">
                Title, details, and an optional image URL are stored on-chain (host the image
                elsewhere — HTTPS or ipfs://). Bid amounts stay encrypted until reveal.
              </p>

              <label className="mt-4 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Title
              </label>
              <input
                type="text"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                maxLength={80}
                placeholder='e.g. "Genesis █ shadow lot"'
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none input-glow placeholder:text-slate-600"
              />

              <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Details
              </label>
              <textarea
                value={draftDescription}
                onChange={(e) => setDraftDescription(e.target.value)}
                maxLength={400}
                rows={4}
                placeholder="Rules, item description, shipping notes, links…"
                className="mt-1 w-full resize-none rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none input-glow placeholder:text-slate-600"
              />

              <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Image URL (optional)
              </label>
              <input
                type="url"
                value={draftImageUri}
                onChange={(e) => setDraftImageUri(e.target.value)}
                maxLength={220}
                placeholder="https://… or ipfs://…"
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-white outline-none input-glow placeholder:text-slate-600"
              />

              <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={lockDeadlineOnCreate}
                    onChange={(e) => setLockDeadlineOnCreate(e.target.checked)}
                    className="rounded border-white/20 bg-black/40"
                  />
                  Lock bidding deadline now (immutable)
                </label>
                {lockDeadlineOnCreate ? (
                  <div className="mt-3 flex items-center gap-3">
                    <input
                      type="range"
                      min={5}
                      max={10080}
                      step={5}
                      value={createDeadlineMinutes}
                      onChange={(e) =>
                        setCreateDeadlineMinutes(Number(e.target.value))
                      }
                      className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-white/10 accent-violet-500"
                    />
                    <span className="w-24 text-right font-mono text-xs text-violet-200">
                      {createDeadlineMinutes < 60
                        ? `${createDeadlineMinutes}m`
                        : createDeadlineMinutes < 1440
                          ? `${Math.round(createDeadlineMinutes / 60)}h`
                          : `${Math.round(createDeadlineMinutes / 1440)}d`}
                    </span>
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                disabled={
                  creating || rpcReachable === false || !draftTitle.trim()
                }
                onClick={() => void submitCreate().catch(reportError)}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-violet-400/40 bg-gradient-to-r from-violet-600 via-fuchsia-600 to-indigo-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {creating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                {creating ? "Creating…" : "Create on-chain + open terminal"}
              </button>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </AppShell>
  );
}

function EmptyState({
  connected,
  hasMine,
  filter,
}: {
  connected: boolean;
  hasMine: boolean;
  filter: AuctionFilter;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-12 text-center">
      <Filter className="mx-auto h-6 w-6 text-violet-300/60" />
      <p className="mt-2 text-sm text-slate-300">
        {filter === "mine"
          ? hasMine
            ? "You have an auction but it isn't on this filter."
            : "You haven't created an auction yet."
          : "No auctions match the current filter."}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        {connected
          ? "Click \u201cCreate new auction\u201d above to open one."
          : "Connect a wallet to create a listing."}
      </p>
    </div>
  );
}
