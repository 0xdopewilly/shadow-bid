/** True when the RPC URL targets a developer validator on this machine (not shared hosting). */
export function isLocalSolanaRpc(endpoint: string): boolean {
  return /127\.0\.0\.1|localhost|:8899\b/.test(endpoint);
}

export function isDevnetRpc(endpoint: string): boolean {
  return /devnet/i.test(endpoint);
}
