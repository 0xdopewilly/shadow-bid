import type { Connection } from "@solana/web3.js";
import { isDevnetRpc, isLocalSolanaRpc } from "@/lib/solana/cluster";

/** Quick check that the RPC accepts JSON-RPC (validator / proxy is up). */
export async function isRpcReachable(
  connection: Connection,
  timeoutMs = 4500
): Promise<boolean> {
  const ping = connection.getLatestBlockhash("processed");
  const timeout = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error("timeout")), timeoutMs)
  );
  try {
    await Promise.race([ping, timeout]);
    return true;
  } catch {
    return false;
  }
}

export function isNetworkFailure(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return /failed to fetch|fetch failed|load failed|networkerror|network request failed|econnrefused|connection refused|refused to connect/i.test(
    raw
  );
}

export function formatRpcOrNetworkError(err: unknown, rpcEndpoint: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  const looksLikeTxConfirmTimeout =
    /not confirmed in [\d.]+ second/i.test(raw) ||
    /TransactionExpiredTimeoutError/i.test(raw);
  const looksLikeNetworkTimeout =
    /timeout/i.test(raw) && !looksLikeTxConfirmTimeout;

  if (
    /failed to fetch|fetch failed|load failed|networkerror|network request failed|econnrefused|connection refused/i.test(
      raw
    ) ||
    looksLikeNetworkTimeout
  ) {
    return `Unable to reach RPC at ${rpcEndpoint}. Verify NEXT_PUBLIC_SOLANA_RPC_URL and network connectivity.`;
  }
  return raw;
}

/** Plain-language hints for common Solana / Anchor errors shown in toasts. */
export function humanizeSolanaTxError(message: string, rpcEndpoint: string): string {
  if (
    /Attempt to debit an account but found no record of a prior credit/i.test(
      message
    )
  ) {
    const lines = [
      "This wallet has no SOL on this cluster. Fund it for transaction fees and rent.",
      "",
    ];
    if (isDevnetRpc(rpcEndpoint)) {
      lines.push("Devnet: request SOL from https://faucet.solana.com for your wallet address.");
    } else if (isLocalSolanaRpc(rpcEndpoint)) {
      lines.push(`Example (replace with your address):`);
      lines.push(`solana airdrop 5 <YOUR_ADDRESS> --url ${rpcEndpoint}`);
      lines.push("");
      lines.push(
        "Local validator scripts often fund only the CLI default keypair—fund the same address you connect in the browser."
      );
    } else {
      lines.push(`Fund this wallet on the target cluster (endpoint: ${rpcEndpoint}).`);
    }
    return lines.join("\n");
  }
  if (/ProgramAccountNotFound/i.test(message)) {
    const lines = [
      "Solana does not see the Shadow Bid program bytecode at NEXT_PUBLIC_SHADOW_BID_PROGRAM_ID on this cluster.",
      "",
      `RPC in use: ${rpcEndpoint}`,
      "",
      "Fix: deploy shadow_bid to this cluster with the same declare_id as web/lib/idl/shadow_bid.json, paste that pubkey into NEXT_PUBLIC_SHADOW_BID_PROGRAM_ID in Vercel, redeploy the site—or point the app at the cluster where your program actually lives.",
    ];
    return lines.join("\n");
  }
  if (/not confirmed in [\d.]+ second/i.test(message)) {
    return [
      message.trim(),
      "",
      "Confirmation exceeded the client wait window; the transaction may still land. Verify the signature in a Solana explorer for this cluster before retrying.",
    ].join("\n");
  }
  if (/InvalidRevealOutput|6011|Reveal output inconsistent/i.test(message)) {
    return [
      message.trim(),
      "",
      'On-chain sealed bid counter is zero but the MPC output was not an "empty auction" (0 SOL + no winner). That usually means the encrypted state never recorded a finalized bid.',
      "",
      'Also verify NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET matches your `arcium deploy -o …` value (e.g. 456). Wrong offset ⇒ bid_count never increments and reveals look like they “do nothing”.',
    ].join("\n");
  }
  if (/AbortedComputation|The computation was aborted|\b6000\b/i.test(message)) {
    return [
      message.trim(),
      "",
      "The Arcium computation did not verify (callback aborted). Typical causes: wrong Arcium cluster offset vs deploy, uninitialized circuits (`yarn init:mxe-circuits`), or Devnet MXC lag—retry after confirming env matches your arcium deploy flags.",
    ].join("\n");
  }
  return message;
}
