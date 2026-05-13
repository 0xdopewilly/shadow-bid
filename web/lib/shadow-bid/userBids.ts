// Per-wallet browser-only cache of sealed bids this wallet submitted (plaintext never leaves the device).
// Powers the private dashboard and reveal summary UI.

export type StoredBid = {
  /** auction PDA base58 */
  auction: string;
  /** lamports (string for safe BigInt round-trip) */
  lamports: string;
  /** SOL string for display (`bidInput` as typed, may include decimals) */
  solDisplay: string;
  /** unix ms */
  ts: number;
  /** tx signature for explorer link */
  txSig?: string;
  /** Arcium computation_offset (BN as base-10 string) so user can later claim rent */
  computationOffset?: string;
  /** Whether claimComputationRent has been successfully called for this bid */
  rentClaimed?: boolean;
};

const KEY_PREFIX = "shadowbid:userbids:";

function key(walletPk: string): string {
  return KEY_PREFIX + walletPk;
}

function safeRead(walletPk: string): StoredBid[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key(walletPk));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredBid[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function safeWrite(walletPk: string, bids: StoredBid[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(walletPk), JSON.stringify(bids));
  } catch {
    /* quota exceeded — silently ignore */
  }
}

export function listUserBids(walletPk: string): StoredBid[] {
  return safeRead(walletPk).sort((a, b) => b.ts - a.ts);
}

export function listUserBidsForAuction(
  walletPk: string,
  auction: string
): StoredBid[] {
  return listUserBids(walletPk).filter((b) => b.auction === auction);
}

export function addUserBid(walletPk: string, bid: StoredBid): void {
  const all = safeRead(walletPk);
  all.unshift(bid);
  safeWrite(walletPk, all.slice(0, 200));
}

export function clearUserBids(walletPk: string): void {
  safeWrite(walletPk, []);
}

export function markBidRentClaimed(
  walletPk: string,
  computationOffset: string
): void {
  const all = safeRead(walletPk);
  const next = all.map((b) =>
    b.computationOffset === computationOffset ? { ...b, rentClaimed: true } : b
  );
  safeWrite(walletPk, next);
}

export function highestUserBidLamports(
  walletPk: string,
  auction: string
): bigint | null {
  const bids = listUserBidsForAuction(walletPk, auction);
  if (bids.length === 0) return null;
  let max = BigInt(0);
  for (const b of bids) {
    try {
      const l = BigInt(b.lamports);
      if (l > max) max = l;
    } catch {
      /* ignore */
    }
  }
  return max;
}
