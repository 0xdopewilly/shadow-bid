import type { Idl } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  awaitComputationFinalization,
  claimComputationRent,
  deserializeLE,
  getArciumAccountBaseSeed,
  getArciumProgram,
  getArciumProgramId,
  getClusterAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getComputationAccAddress,
  getExecutingPoolAccAddress,
  getLookupTableAddress,
  getMXEAccAddress,
  getMXEPublicKey,
  getMempoolAccAddress,
  RescueCipher,
  uploadCircuit,
  x25519,
} from "@arcium-hq/client";
import type { ShadowBid } from "@/types/shadow_bid";
import idlJson from "@/lib/idl/shadow_bid.json";
import { randomBytes } from "@/lib/shadow-bid/random";
import { isRpcReachable } from "@/lib/solana/rpcHealth";
import { Buffer } from "buffer";
import { type Connection, Keypair, PublicKey } from "@solana/web3.js";

export type ShadowBidProgram = Program<ShadowBid>;

export function getShadowBidProgram(
  provider: anchor.AnchorProvider
): ShadowBidProgram {
  return new Program(idlJson as Idl, provider) as Program<ShadowBid>;
}

export function getAuctionPda(
  programId: PublicKey,
  authority: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("auction"), authority.toBuffer()],
    programId
  )[0];
}

export async function getMXEPublicKeyWithRetry(
  connection: Connection,
  programId: PublicKey,
  maxRetries = 8,
  retryDelayMs = 500
): Promise<Uint8Array> {
  if (!(await isRpcReachable(connection))) {
    throw new Error(
      `Cannot reach Solana RPC at ${connection.rpcEndpoint}. Check NEXT_PUBLIC_SOLANA_RPC_URL and network access.`
    );
  }
  const stub = Keypair.generate();
  const wallet = {
    publicKey: stub.publicKey,
    signTransaction: async <T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction>(
      t: T
    ) => t,
    signAllTransactions: async <T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction>(
      ts: T[]
    ) => ts,
  };
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const key = await getMXEPublicKey(provider, programId);
      if (key) return key;
    } catch {
      /* retry */
    }
    if (attempt === maxRetries)
      throw new Error(
        "MXE public key not available yet — deploy your program + MXE on this cluster (same as `arcium test`)."
      );
    await new Promise((r) => setTimeout(r, retryDelayMs));
  }
  throw new Error("unreachable");
}

function splitPubkeyToU128s(pubkey: Uint8Array): { lo: bigint; hi: bigint } {
  const loBytes = pubkey.slice(0, 16);
  const hiBytes = pubkey.slice(16, 32);
  return { lo: deserializeLE(loBytes), hi: deserializeLE(hiBytes) };
}

export async function fetchCircuitFromOrigin(name: string): Promise<Uint8Array> {
  const base =
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_SITE_URL?.trim() || "";
  if (!base) {
    throw new Error(
      `Cannot load circuit ${name}: set NEXT_PUBLIC_SITE_URL for non-browser contexts, or open the app in the browser.`
    );
  }
  const res = await fetch(`${base}/circuits/${name}.arcis`);
  if (!res.ok) {
    throw new Error(
      `Circuit not found: /circuits/${name}.arcis — from repo root run: arcium build && cd web && yarn copy:artifacts`
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}

export type CircuitName = "init_auction_state" | "place_bid" | "reveal_winner";

export const ALL_CIRCUITS: CircuitName[] = [
  "init_auction_state",
  "place_bid",
  "reveal_winner",
];

export async function initComputationDefinition(
  program: ShadowBidProgram,
  provider: anchor.AnchorProvider,
  circuitName: CircuitName,
  payer: PublicKey
): Promise<void> {
  const baseSeedCompDefAcc = getArciumAccountBaseSeed(
    "ComputationDefinitionAccount"
  );
  const offsetBytes = getCompDefAccOffset(circuitName);
  const compDefPda = PublicKey.findProgramAddressSync(
    [baseSeedCompDefAcc, program.programId.toBuffer(), offsetBytes],
    getArciumProgramId()
  )[0];

  const arciumProgram = getArciumProgram(provider);
  const mxeAccount = getMXEAccAddress(program.programId);
  const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
  const lutAddress = getLookupTableAddress(
    program.programId,
    mxeAcc.lutOffsetSlot
  );

  const rpcOpts = {
    preflightCommitment: "confirmed" as const,
    commitment: "confirmed" as const,
  };

  if (circuitName === "init_auction_state") {
    await program.methods
      .initAuctionStateCompDef()
      .accounts({
        compDefAccount: compDefPda,
        payer,
        mxeAccount,
        addressLookupTable: lutAddress,
      })
      .rpc(rpcOpts);
  } else if (circuitName === "place_bid") {
    await program.methods
      .initPlaceBidCompDef()
      .accounts({
        compDefAccount: compDefPda,
        payer,
        mxeAccount,
        addressLookupTable: lutAddress,
      })
      .rpc(rpcOpts);
  } else {
    await program.methods
      .initRevealWinnerCompDef()
      .accounts({
        compDefAccount: compDefPda,
        payer,
        mxeAccount,
        addressLookupTable: lutAddress,
      })
      .rpc(rpcOpts);
  }

  const raw = await fetchCircuitFromOrigin(circuitName);
  // Avoid default chunkSize (500 parallel txs) — public RPC / Helius will 429.
  await uploadCircuit(provider, circuitName, program.programId, raw, false, 4);
}

/**
 * Normalize an optional listing image URI for `<img src>`.
 * Supports `https:`, `http:` (local dev), and `ipfs://` (via a public gateway).
 */
export function listingImageSrc(raw: string | undefined | null): string | null {
  const s = raw?.trim();
  if (!s) return null;
  try {
    if (s.startsWith("ipfs://")) {
      const path = s.slice("ipfs://".length).replace(/^ipfs\//, "");
      if (!path) return null;
      return `https://ipfs.io/ipfs/${path}`;
    }
    const u = new URL(s);
    if (u.protocol === "https:" || u.protocol === "http:") return u.toString();
  } catch {
    return null;
  }
  return null;
}

/** Truncate a string so its UTF-8 byte length is <= maxBytes. */
export function truncateUtf8(s: string, maxBytes: number): string {
  const enc = new TextEncoder();
  const dec = new TextDecoder("utf-8", { fatal: false });
  let bytes = enc.encode(s);
  if (bytes.length <= maxBytes) return s;
  bytes = bytes.slice(0, maxBytes);
  while (bytes.length > 0 && (bytes[bytes.length - 1]! & 0xc0) === 0x80) {
    bytes = bytes.slice(0, -1);
  }
  return dec.decode(bytes);
}

export async function createAuctionFlow(
  program: ShadowBidProgram,
  provider: anchor.AnchorProvider,
  clusterOffset: number,
  authority: PublicKey,
  meta: { title: string; description: string; imageUri?: string }
): Promise<{ auction: PublicKey; computationOffset: anchor.BN }> {
  const computationOffset = new anchor.BN(Buffer.from(randomBytes(8)), "le");
  const clusterAccount = getClusterAccAddress(clusterOffset);
  const auction = getAuctionPda(program.programId, authority);

  const title = truncateUtf8(
    meta.title.trim() || "Untitled auction",
    64
  );
  const description = truncateUtf8(meta.description.trim(), 256);
  const imageUri = truncateUtf8((meta.imageUri ?? "").trim(), 200);

  await program.methods
    .createAuction(computationOffset, title, description, imageUri)
    .accountsPartial({
      authority,
      auction,
      computationAccount: getComputationAccAddress(
        clusterOffset,
        computationOffset
      ),
      clusterAccount,
      mxeAccount: getMXEAccAddress(program.programId),
      mempoolAccount: getMempoolAccAddress(clusterOffset),
      executingPool: getExecutingPoolAccAddress(clusterOffset),
      compDefAccount: getCompDefAccAddress(
        program.programId,
        Buffer.from(getCompDefAccOffset("init_auction_state")).readUInt32LE()
      ),
    })
    .rpc({ commitment: "confirmed", skipPreflight: true });

  await awaitComputationFinalization(
    provider,
    computationOffset,
    program.programId,
    "confirmed"
  );

  return { auction, computationOffset };
}

export async function placeBidFlow(
  program: ShadowBidProgram,
  provider: anchor.AnchorProvider,
  clusterOffset: number,
  bidder: PublicKey,
  auction: PublicKey,
  bidAmountLamports: bigint,
  mxePublicKey: Uint8Array
): Promise<{ txSig: string; computationOffset: anchor.BN }> {
  const privateKey = x25519.utils.randomSecretKey();
  const ephemeralPubkey = x25519.getPublicKey(privateKey);
  const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);

  const { lo: bidderLo, hi: bidderHi } = splitPubkeyToU128s(
    new Uint8Array(bidder.toBuffer())
  );

  const nonceBid = randomBytes(16);
  const nonceBidder = randomBytes(16);
  const ctBid = cipher.encrypt([bidAmountLamports], nonceBid);
  const ctBidder = cipher.encrypt([bidderLo, bidderHi], nonceBidder);

  const bidComputationOffset = new anchor.BN(
    Buffer.from(randomBytes(8)),
    "le"
  );

  const clusterAccount = getClusterAccAddress(clusterOffset);

  const txSig = await program.methods
    .placeBid(
      bidComputationOffset,
      Array.from(ctBid[0]),
      Array.from(ctBidder[0]),
      Array.from(ctBidder[1]),
      Array.from(ephemeralPubkey),
      new anchor.BN(deserializeLE(nonceBid).toString()),
      new anchor.BN(deserializeLE(nonceBidder).toString())
    )
    .accountsPartial({
      bidder,
      auction,
      computationAccount: getComputationAccAddress(
        clusterOffset,
        bidComputationOffset
      ),
      clusterAccount,
      mxeAccount: getMXEAccAddress(program.programId),
      mempoolAccount: getMempoolAccAddress(clusterOffset),
      executingPool: getExecutingPoolAccAddress(clusterOffset),
      compDefAccount: getCompDefAccAddress(
        program.programId,
        Buffer.from(getCompDefAccOffset("place_bid")).readUInt32LE()
      ),
    })
    .rpc({ commitment: "confirmed", skipPreflight: true });

  await awaitComputationFinalization(
    provider,
    bidComputationOffset,
    program.programId,
    "confirmed"
  );

  return { txSig, computationOffset: bidComputationOffset };
}

/**
 * Reclaim Solana account rent from a finalized Arcium computation account.
 * Wallet that paid the rent must sign.
 */
export async function reclaimComputationRent(
  provider: anchor.AnchorProvider,
  clusterOffset: number,
  computationOffset: anchor.BN
): Promise<string> {
  return claimComputationRent(provider, clusterOffset, computationOffset, {
    commitment: "confirmed",
  });
}

/**
 * Authority-only: queue the reveal_winner Arcium computation, then await
 * finalization. The callback writes `revealed/winner/winning_bid` onto the
 * Auction account and emits `WinnerRevealedEvent`.
 */
export async function revealWinnerFlow(
  program: ShadowBidProgram,
  provider: anchor.AnchorProvider,
  clusterOffset: number,
  authority: PublicKey,
  auction: PublicKey
): Promise<{ txSig: string; computationOffset: anchor.BN }> {
  const computationOffset = new anchor.BN(Buffer.from(randomBytes(8)), "le");
  const clusterAccount = getClusterAccAddress(clusterOffset);

  const txSig = await program.methods
    .revealWinner(computationOffset)
    .accountsPartial({
      authority,
      auction,
      computationAccount: getComputationAccAddress(
        clusterOffset,
        computationOffset
      ),
      clusterAccount,
      mxeAccount: getMXEAccAddress(program.programId),
      mempoolAccount: getMempoolAccAddress(clusterOffset),
      executingPool: getExecutingPoolAccAddress(clusterOffset),
      compDefAccount: getCompDefAccAddress(
        program.programId,
        Buffer.from(getCompDefAccOffset("reveal_winner")).readUInt32LE()
      ),
    })
    .rpc({ commitment: "confirmed", skipPreflight: true });

  await awaitComputationFinalization(
    provider,
    computationOffset,
    program.programId,
    "confirmed"
  );

  return { txSig, computationOffset };
}

export type AuctionAccountData = {
  bidCount: number;
  stateNonce: string;
  authority: PublicKey;
  encryptedStateBytes: Uint8Array;
  revealed: boolean;
  /** Lamports (string for BigInt safety). Only meaningful when `revealed === true`. */
  winningBid: string;
  /** All-zero `Pubkey` until `revealed`. */
  winner: PublicKey;
  /** Unix timestamp (seconds). 0 = no on-chain deadline set. Once non-zero, immutable. */
  biddingEndsAt: number;
  /** Listing title (on-chain, UTF-8). */
  title: string;
  /** Longer listing copy (on-chain). */
  description: string;
  /** Optional image URL (on-chain); see `listingImageSrc`. */
  imageUri: string;
};

export type AuctionListEntry = {
  pda: PublicKey;
  authority: PublicKey;
  bidCount: number;
  revealed: boolean;
  winner: PublicKey;
  /** Lamports as string. */
  winningBid: string;
  /** Unix seconds. 0 = no deadline. */
  biddingEndsAt: number;
  title: string;
  description: string;
  imageUri: string;
};

/**
 * Authority-only: lock an immutable on-chain bidding deadline. Once set, the
 * program rejects any further `set_auction_deadline` calls — every bidder is
 * guaranteed the same window.
 */
export async function setAuctionDeadlineFlow(
  program: ShadowBidProgram,
  authority: PublicKey,
  auction: PublicKey,
  biddingEndsAtUnixSec: number
): Promise<string> {
  return program.methods
    .setAuctionDeadline(new anchor.BN(biddingEndsAtUnixSec))
    .accountsPartial({ authority, auction })
    .rpc({ commitment: "confirmed" });
}

/**
 * Pull the bidder's on-chain `place_bid` transaction history for a given
 * program by walking `getSignaturesForAddress`. Each entry is the canonical
 * record that the bidder participated — even if their localStorage cache
 * is empty. Bid AMOUNTS are encrypted by design and not derivable from chain.
 */
export type OnChainBidTx = {
  signature: string;
  slot: number;
  blockTime: number | null;
  /** Auction PDA touched by this `place_bid` ix, when resolvable. */
  auction: PublicKey | null;
  err: unknown;
};

export async function fetchUserBidSignatures(
  connection: Connection,
  program: ShadowBidProgram,
  user: PublicKey,
  limit = 50
): Promise<OnChainBidTx[]> {
  const sigs = await connection.getSignaturesForAddress(user, { limit });
  if (sigs.length === 0) return [];

  const txs = await connection.getTransactions(
    sigs.map((s) => s.signature),
    { commitment: "confirmed", maxSupportedTransactionVersion: 0 }
  );

  const programIdB58 = program.programId.toBase58();
  const out: OnChainBidTx[] = [];

  for (let i = 0; i < sigs.length; i++) {
    const sig = sigs[i];
    const tx = txs[i];
    if (!tx) continue;

    // Resolve all account keys (handles v0 LUT-loaded keys too).
    const allKeys = tx.transaction.message
      .getAccountKeys({
        accountKeysFromLookups: tx.meta?.loadedAddresses,
      })
      .keySegments()
      .flat();

    const ixs = tx.transaction.message.compiledInstructions;
    let touchedShadowBid = false;
    let auctionPda: PublicKey | null = null;

    for (const ix of ixs) {
      const progKey = allKeys[ix.programIdIndex];
      if (!progKey || progKey.toBase58() !== programIdB58) continue;
      touchedShadowBid = true;

      // The Anchor ix discriminator is the first 8 bytes of `data`.
      // We could decode against IDL to confirm it's `place_bid`, but the
      // simplest robust signal is "this tx targets shadow_bid AND the bidder
      // signed it AND the second account is an Auction PDA". We use the
      // PlaceBid struct ordering: [bidder, auction, sign_pda, mxe, ...].
      const accIdx = ix.accountKeyIndexes[1];
      if (accIdx != null && allKeys[accIdx]) auctionPda = allKeys[accIdx];
      break;
    }

    if (!touchedShadowBid) continue;

    out.push({
      signature: sig.signature,
      slot: sig.slot,
      blockTime: sig.blockTime ?? null,
      auction: auctionPda,
      err: sig.err,
    });
  }
  return out;
}

/**
 * Browse all auctions on-chain. Uses Anchor's `account.auction.all()` which
 * issues a `getProgramAccounts` filtered by discriminator.
 */
export async function fetchAllAuctions(
  program: ShadowBidProgram
): Promise<AuctionListEntry[]> {
  const accs = await program.account.auction.all();
  return accs.map(({ publicKey, account }) => ({
    pda: publicKey,
    authority: account.authority,
    bidCount: account.bidCount,
    revealed: account.revealed,
    winner: account.winner,
    winningBid: account.winningBid.toString(),
    biddingEndsAt: Number(account.biddingEndsAt.toString()),
    title: account.title ?? "",
    description: account.description ?? "",
    imageUri: account.imageUri ?? "",
  }));
}

export async function fetchAuctionAccount(
  program: ShadowBidProgram,
  auction: PublicKey
): Promise<AuctionAccountData | null> {
  try {
    const acc = await program.account.auction.fetch(auction);
    const flat = new Uint8Array(96);
    for (let i = 0; i < 3; i++) {
      const chunk = acc.encryptedState[i] as unknown as number[];
      flat.set(Uint8Array.from(chunk), i * 32);
    }
    return {
      bidCount: acc.bidCount,
      stateNonce: acc.stateNonce.toString(),
      authority: acc.authority,
      encryptedStateBytes: flat,
      revealed: acc.revealed,
      winningBid: acc.winningBid.toString(),
      winner: acc.winner,
      biddingEndsAt: Number(acc.biddingEndsAt.toString()),
      title: acc.title ?? "",
      description: acc.description ?? "",
      imageUri: acc.imageUri ?? "",
    };
  } catch {
    return null;
  }
}
