"use client";

import {
  ALL_CIRCUITS,
  fetchAllAuctions,
  getMXEPublicKeyWithRetry,
  getReadOnlyShadowBidProgram,
  getShadowBidProgram,
  initComputationDefinition,
  reclaimComputationRent,
  fetchCircuitFromOrigin,
  type ShadowBidProgram,
  type AuctionListEntry,
} from "@/lib/shadow-bid/flows";
import { getArciumClusterOffset } from "@/lib/solana/env";
import { isLocalSolanaRpc } from "@/lib/solana/cluster";
import {
  formatRpcOrNetworkError,
  humanizeSolanaTxError,
  isNetworkFailure,
  isRpcReachable,
} from "@/lib/solana/rpcHealth";
import * as anchor from "@coral-xyz/anchor";
import {
  useAnchorWallet,
  useConnection,
  useWallet,
} from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ToastStack, type Toast } from "@/components/shadow-bid/Toasts";

type CircuitsProbe = "unknown" | "ok" | "missing";

export type FeedRow = {
  id: string;
  msg: string;
  ts: number;
  chain?: boolean;
};

type Ctx = {
  // wallet / connection
  publicKey: ReturnType<typeof useAnchorWallet> extends infer T
    ? T extends { publicKey: infer P }
      ? P | null
      : null
    : null;
  walletPk: string | null;
  connected: boolean;
  connecting: boolean;
  openWalletModal: () => void;
  disconnect: () => void;
  rpcEndpoint: string;

  // chain
  /** Anchor program bound to RPC; works for reads even without a wallet. Use `provider` for signed txs only. */
  program: ShadowBidProgram;
  provider: anchor.AnchorProvider | null;
  clusterOffset: number;
  rpcReachable: boolean | null;
  mxePub: Uint8Array | null;
  solBalance: number | null;
  circuitsProbe: CircuitsProbe;
  syncing: boolean;
  syncChain: () => Promise<void>;

  // auctions list (browse)
  allAuctions: AuctionListEntry[];
  auctionsLoading: boolean;
  refreshAllAuctions: () => Promise<void>;

  // notifications
  feed: FeedRow[];
  pushFeed: (msg: string, chain?: boolean, dedupeMs?: number) => void;
  clearFeed: () => void;
  reportError: (e: unknown) => void;
  pushToast: (t: Omit<Toast, "id" | "ts">) => void;

  // helpers
  copyToClipboard: (label: string, text: string) => Promise<void>;
  copyFlash: string | null;

  // operator
  initAllCircuits: () => Promise<void>;
  initBusy: boolean;

  // rent
  reclaimRent: (computationOffsetStr: string) => Promise<string>;
};

const ShadowBidCtx = createContext<Ctx | null>(null);

export function useShadowBid(): Ctx {
  const ctx = useContext(ShadowBidCtx);
  if (!ctx)
    throw new Error("useShadowBid must be used inside <ShadowBidProvider>");
  return ctx;
}

export function ShadowBidProvider({ children }: { children: ReactNode }) {
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { disconnect, connecting, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const publicKey = anchorWallet?.publicKey ?? null;
  const walletPk = publicKey?.toBase58() ?? null;

  const clusterOffset = useMemo(() => getArciumClusterOffset(), []);

  const provider = useMemo(() => {
    if (!anchorWallet) return null;
    return new anchor.AnchorProvider(connection, anchorWallet, {
      commitment: "confirmed",
    });
  }, [connection, anchorWallet]);

  const program = useMemo(
    () =>
      provider != null
        ? getShadowBidProgram(provider)
        : getReadOnlyShadowBidProgram(connection),
    [provider, connection]
  );

  const [rpcReachable, setRpcReachable] = useState<boolean | null>(null);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [mxePub, setMxePub] = useState<Uint8Array | null>(null);
  const [circuitsProbe, setCircuitsProbe] = useState<CircuitsProbe>("unknown");
  const [syncing, setSyncing] = useState(false);

  const [feed, setFeed] = useState<FeedRow[]>([]);
  const lastFeedDedupe = useRef<{ msg: string; t: number } | null>(null);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismissToast = useCallback((id: string) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);
  const pushToast = useCallback(
    (t: Omit<Toast, "id" | "ts">) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setToasts((cur) => [{ ...t, id, ts: Date.now() }, ...cur].slice(0, 6));
      window.setTimeout(() => dismissToast(id), 7000);
    },
    [dismissToast]
  );

  const pushFeed = useCallback(
    (msg: string, chain = true, dedupeMs = 0) => {
      const now = Date.now();
      if (dedupeMs > 0 && lastFeedDedupe.current) {
        const { msg: prev, t } = lastFeedDedupe.current;
        if (prev === msg && now - t < dedupeMs) return;
      }
      if (dedupeMs > 0) lastFeedDedupe.current = { msg, t: now };

      setFeed((prev) => [
        {
          id: `${now}-${Math.random().toString(36).slice(2)}`,
          msg,
          ts: now,
          chain,
        },
        ...prev.slice(0, 49),
      ]);
    },
    []
  );

  const clearFeed = useCallback(() => setFeed([]), []);

  const reportError = useCallback(
    (e: unknown) => {
      if (isNetworkFailure(e)) return;
      let msg = formatRpcOrNetworkError(e, connection.rpcEndpoint);
      msg = humanizeSolanaTxError(msg, connection.rpcEndpoint);
      if (isNetworkFailure(new Error(msg))) return;

      const isArciumAuth =
        /InvalidAuthority/i.test(msg) ||
        /The given authority is invalid/i.test(msg);
      if (isArciumAuth) {
        msg += isLocalSolanaRpc(connection.rpcEndpoint)
          ? "\n\nMXE circuit initialization must be signed by the MXE authority keypair for this sandbox (typically ~/.config/solana/id.json). Run `yarn init:mxe-circuits` from the repository root, then use your browser wallet for create, bid, and reveal."
          : "\n\nThis transaction requires the MXE authority configured for this deployment. Contact the operator if it persists.";
      }

      pushFeed(msg, true, 12_000);
      pushToast({ kind: "warn", title: "Action failed", body: msg });
    },
    [connection.rpcEndpoint, pushFeed, pushToast]
  );

  // RPC probe
  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      const ok = await isRpcReachable(connection);
      if (!cancelled) setRpcReachable(ok);
    };
    void ping();
    const t = setInterval(() => void ping(), 12_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [connection]);

  /** Wrong offset ⇒ wrong MXC PDAs; bids never finalize and reveal appears stuck */
  const warnedArciumCluster = useRef(false);
  useEffect(() => {
    if (warnedArciumCluster.current) return;
    if (rpcReachable !== true) return;
    if (clusterOffset !== 0) return;
    if (isLocalSolanaRpc(connection.rpcEndpoint)) return;
    warnedArciumCluster.current = true;
    pushToast({
      kind: "warn",
      title: "Arcium cluster offset is 0",
      body:
        "Sealed bids and reveal talk to MXC via computation PDAs. If you deployed with `arcium deploy -o 456`, set NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET=456 in web/.env.local (and Vercel), rebuild, reload — otherwise bid_count stays 0 and reveal never settles.",
    });
  }, [clusterOffset, connection.rpcEndpoint, pushToast, rpcReachable]);

  // SOL balance
  useEffect(() => {
    if (!publicKey || rpcReachable !== true) {
      setSolBalance(null);
      return;
    }
    let cancelled = false;
    void connection
      .getBalance(publicKey)
      .then((l) => !cancelled && setSolBalance(l / 1e9))
      .catch(() => !cancelled && setSolBalance(null));
    return () => {
      cancelled = true;
    };
  }, [publicKey, connection, rpcReachable]);

  // Circuit blob probe
  useEffect(() => {
    void (async () => {
      try {
        await fetchCircuitFromOrigin("init_auction_state");
        setCircuitsProbe("ok");
      } catch {
        setCircuitsProbe("missing");
      }
    })();
  }, []);

  // MXE pubkey fetch
  useEffect(() => {
    if (!publicKey || !program || rpcReachable !== true) {
      setMxePub(null);
      return;
    }
    void (async () => {
      try {
        const k = await getMXEPublicKeyWithRetry(connection, program.programId);
        setMxePub(k);
      } catch {
        setMxePub(null);
      }
    })();
  }, [publicKey, program, connection, rpcReachable]);

  const syncChain = useCallback(async () => {
    setSyncing(true);
    try {
      const ok = await isRpcReachable(connection);
      setRpcReachable(ok);
      if (ok && publicKey && program) {
        try {
          const k = await getMXEPublicKeyWithRetry(connection, program.programId);
          setMxePub(k);
        } catch {
          setMxePub(null);
        }
      }
    } finally {
      setSyncing(false);
    }
  }, [connection, publicKey, program]);

  // Auctions list
  const [allAuctions, setAllAuctions] = useState<AuctionListEntry[]>([]);
  const [auctionsLoading, setAuctionsLoading] = useState(false);

  const refreshAllAuctions = useCallback(async () => {
    if (rpcReachable !== true) {
      return;
    }
    setAuctionsLoading(true);
    try {
      const list = await fetchAllAuctions(program);
      setAllAuctions(list);
    } catch {
      // Keep the last successful list during flaky RPC so the UI doesn't look
      // like you never created an auction.
    } finally {
      setAuctionsLoading(false);
    }
  }, [program, rpcReachable]);

  useEffect(() => {
    void refreshAllAuctions();
    const t = setInterval(() => void refreshAllAuctions(), 15_000);
    return () => clearInterval(t);
  }, [refreshAllAuctions]);

  const [copyFlash, setCopyFlash] = useState<string | null>(null);
  const copyToClipboard = useCallback(
    async (label: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopyFlash(label);
        setTimeout(() => setCopyFlash((c) => (c === label ? null : c)), 1600);
        pushFeed(`Copied ${label}.`, true, 4000);
      } catch {
        pushFeed("Copy failed — allow clipboard access.", true);
      }
    },
    [pushFeed]
  );

  const [initBusy, setInitBusy] = useState(false);
  const initAllCircuits = useCallback(async () => {
    if (!program || !provider || !publicKey)
      throw new Error("Connect wallet first");
    setInitBusy(true);
    try {
      for (const circuit of ALL_CIRCUITS) {
        try {
          await initComputationDefinition(program, provider, circuit, publicKey);
          pushFeed(`Circuit ${circuit} uploaded.`, true);
          pushToast({
            kind: "info",
            title: `${circuit} circuit live`,
            body: "Installed on this MXE cluster.",
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/user rejected|user denied|rejected the request/i.test(msg)) {
            pushToast({
              kind: "info",
              title: "Signature declined",
              body: "Circuit initialization was cancelled in the wallet. Complete signing for each prompt, or run repository MXE provisioning from an authorized CLI keypair.",
            });
            pushFeed("MXE init cancelled in wallet.", true);
            return;
          }
          const alreadyThere =
            /already in use/i.test(msg) ||
            (/Allocate/i.test(msg) && /account Address/i.test(msg));
          if (alreadyThere) {
            pushToast({
              kind: "info",
              title: `${circuit} already on-chain`,
              body: "Skipped: computation definition already initialized.",
            });
            pushFeed(`Circuit ${circuit} already installed — skipped.`, true);
            continue;
          }
          throw e;
        }
      }
    } finally {
      setInitBusy(false);
    }
  }, [program, provider, publicKey, pushFeed, pushToast]);

  const reclaimRent = useCallback(
    async (computationOffsetStr: string) => {
      if (!provider) throw new Error("Connect wallet first");
      const offset = new anchor.BN(computationOffsetStr, 10);
      const sig = await reclaimComputationRent(provider, clusterOffset, offset);
      pushFeed(`Reclaimed computation rent · tx ${sig.slice(0, 6)}…${sig.slice(-6)}`, true);
      pushToast({
        kind: "info",
        title: "Rent reclaimed",
        body: "Lamports returned from a finalized Arcium computation.",
      });
      return sig;
    },
    [provider, clusterOffset, pushFeed, pushToast]
  );

  const value: Ctx = {
    publicKey,
    walletPk,
    connected,
    connecting,
    openWalletModal: () => setVisible(true),
    disconnect: () => disconnect(),
    rpcEndpoint: connection.rpcEndpoint,
    program,
    provider,
    clusterOffset,
    rpcReachable,
    mxePub,
    solBalance,
    circuitsProbe,
    syncing,
    syncChain,
    allAuctions,
    auctionsLoading,
    refreshAllAuctions,
    feed,
    pushFeed,
    clearFeed,
    reportError,
    pushToast,
    copyToClipboard,
    copyFlash,
    initAllCircuits,
    initBusy,
    reclaimRent,
  };

  return (
    <ShadowBidCtx.Provider value={value}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </ShadowBidCtx.Provider>
  );
}
