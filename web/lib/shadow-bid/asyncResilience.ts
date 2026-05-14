import { isNetworkFailure } from "@/lib/solana/rpcHealth";

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** True for typical flaky-RPC / proxy failures where a short retry often succeeds. */
export function isTransientRpcLikeError(err: unknown): boolean {
  if (isNetworkFailure(err)) return true;
  const raw = err instanceof Error ? err.message : String(err);
  return /\b429\b|rate limit|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket|Service Unavailable|503|502|504|Bad Gateway|Unexpected server response|too many requests/i.test(
    raw
  );
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    maxAttempts?: number;
    delaysMs?: number[];
    shouldRetry?: (err: unknown) => boolean;
  }
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const delays = opts.delaysMs ?? [400, 1200, 2400];
  const shouldRetry =
    opts.shouldRetry ?? ((e: unknown) => isTransientRpcLikeError(e));

  let last: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (attempt === maxAttempts - 1 || !shouldRetry(e)) throw e;
      const d = delays[Math.min(attempt, delays.length - 1)] ?? 800;
      await sleep(d);
    }
  }
  throw last;
}
