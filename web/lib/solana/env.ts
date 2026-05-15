import { PublicKey } from "@solana/web3.js";

const DEFAULT_PUBLIC_RPC = "https://api.devnet.solana.com";

/** Same knob as ARCIUM_CLUSTER_OFFSET in Node tests; required in browser (getArciumEnv is Node-only). */
export function getArciumClusterOffset(): number {
  const raw = process.env.NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET;
  if (raw === undefined || raw === "") return 0;
  const n = Number(raw);
  if (Number.isNaN(n))
    throw new Error("NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET must be a number");
  return n;
}

/**
 * Shared RPC for all browser clients. Set NEXT_PUBLIC_SOLANA_RPC_URL in deployment (or `.env.local`).
 * Defaults to Solana devnet so deployed builds stay in sync without a localhost validator.
 */
export function getRpcEndpoint(): string {
  const raw = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_PUBLIC_RPC;
}

export function getShadowBidProgramId(): PublicKey {
  const id = process.env.NEXT_PUBLIC_SHADOW_BID_PROGRAM_ID;
  if (!id) {
    return new PublicKey("J1vKHNDu4gLpMrf4Zwzca74rjJo4Lx5MvgKUU7B7UWN7");
  }
  return new PublicKey(id);
}
