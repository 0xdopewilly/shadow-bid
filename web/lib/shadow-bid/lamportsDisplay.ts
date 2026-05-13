/**
 * Format lamports as SOL (up to 9 fractional digits). Uses bigint end-to-end so
 * values above Number.MAX_SAFE_INTEGER are not corrupted by `Number(bigint)`.
 */
export function lamportsToSolDisplay(lamports: string | bigint): string {
  const lamportsPerSol = BigInt("1000000000");
  const raw =
    typeof lamports === "bigint" ? lamports : BigInt(lamports.trim() || "0");
  const neg = raw < BigInt(0);
  const v = neg ? -raw : raw;
  const whole = v / lamportsPerSol;
  const frac = v % lamportsPerSol;
  let fracStr = frac.toString().padStart(9, "0").replace(/0+$/, "");
  const wholeFmt = whole.toLocaleString(undefined);
  const prefix = neg ? "-" : "";
  if (!fracStr) return `${prefix}${wholeFmt}`;
  return `${prefix}${wholeFmt}.${fracStr}`;
}

export function lamportsToSolDisplayWithSuffix(lamports: string | bigint): string {
  try {
    return `${lamportsToSolDisplay(lamports)} SOL`;
  } catch {
    return "— SOL";
  }
}
