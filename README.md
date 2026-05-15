# ShadowBid — sealed-bid auctions on Solana with Arcium

Traditional auctions on a public chain expose every bid. **ShadowBid** keeps **individual bid amounts encrypted** until the seller runs **reveal**: the Arcium MXE compares bids inside MPC and only the **winning pubkey** and **winning bid amount** become public. Losing bids stay sealed.

This repo is an **Arcium + Anchor** reference implementation plus a **Next.js** app for browsing listings, bidding, and (for the listing authority) setting deadlines and revealing the winner.

## What this program actually implements

| Mechanism | Status |
|-----------|--------|
| **Uniform / first-price sealed bid** | Implemented: encrypted state tracks **highest bid** + **highest bidder**; reveal publishes those values. |
| **Vickrey (second-price)** | **Not implemented** — that needs a **second-highest** ciphertext in the MPC state and different reveal logic. |
| **On-chain escrow / automatic refunds** | **Not implemented** — amounts are proofs-of-bid semantics; settlement is assumed off-chain unless you extend the program. |

If a hackathon brief mentions Vickrey, treat ShadowBid as a **minimal sealed-bid building block** where Arcium handles **private comparison + selective decryption** of the aggregate state.

---

## Why Arcium fits

1. **Chain sees ciphertexts** — Validators index `place_bid` transactions but only see encrypted payloads and MXE ciphertext rows, not plaintext amounts suitable for sandwiching or order-flow games.
2. **Comparison inside the MXE** — The `place_bid` Arcis instruction decrypts bids **inside** the MPC context, updates `AuctionState`, and writes fresh MXE ciphertexts back to Solana (`encrypted_state`).
3. **Selective revelation** — `reveal_winner` runs only after optional **deadline** rules are satisfied (`set_auction_deadline` locks an immutable `bidding_ends_at`; reveal requires that time to pass if set). Output is bounded: winner + winning bid lamports — not every historical bid.

The in-app **[About](/about)** page (when you run or deploy the web app) spells out the bidder-facing flow step by step.

---

## Protocol sketch (aligned with code)

1. **`create_auction`** — Seeds the auction account, stores public listing text (`title`, `description`, optional `image_uri`), and queues **`init_auction_state`** so the MXE initializes encrypted `AuctionState`.
2. **`place_bid`** — Client encrypts **bid amount** and **bidder pubkey** fragments with ephemeral X25519 + the MXE key; submits ciphertexts + nonces; Arcium **`place_bid`** circuit merges them into **`Enc<Mxe, AuctionState>`**.
3. **`set_auction_deadline`** (optional, authority once) — Sets `bidding_ends_at` so `place_bid` rejects afterward and `reveal_winner` is only callable after the window closes.
4. **`reveal_winner`** — Authority queues **`reveal_winner`**; callback writes **`revealed`**, **`winner`**, **`winning_bid`** cleartext on-chain.

---

## Encrypted auction state (this repo)

Arcis compilation target lives in **`encrypted-ixs/src/blind_auction.rs`**:

```rust
pub struct AuctionState {
    pub highest_bid: u64,
    pub highest_bidder: SerializedSolanaPublicKey,
}
```

Solana persists **three** 32-byte limbs (`[[u8; 32]; 3]`) — ciphertext material for **`u64` + `SerializedSolanaPublicKey` (lo/hi `u128`)** under the MXE — plus a `state_nonce` for rotation. **`bid_count`** is public and incremented on-chain after each finalized `place_bid` computation.

Winner extraction from the MPC output is flattened in **`reveal_winner_callback`** (`programs/shadow_bid/src/lib.rs`) into **`winning_bid`** plus **`winner` `Pubkey`**.

Learn more about Arcis types at [Arcis Types](https://docs.arcium.com/developers/arcis/types).

---

## Repository layout

- **`programs/shadow_bid`** — Anchor program (`create_auction`, `place_bid`, `set_auction_deadline`, `reveal_winner`, comp-def inits).
- **`encrypted-ixs`** — Arcis circuits (`init_auction_state`, `place_bid`, `reveal_winner`).
- **`web`** — Next.js UI (`/auctions`, `/auctions/[pda]`, `/about`, `/dashboard`).
- **`scripts/init-mxe-circuits.ts`** — One-shot Devnet helper: creates MXE computation definitions (if missing) and uploads `build/*.arcis` (idempotent; see env vars in the file).
- **`scripts/dev.sh`** — Optional local stack: `arcium localnet` + Next (`web` → `yarn dev:full`). Not a substitute for public Devnet hosting.
- **`tests/shadow_bid.ts`** — Integration test for create → bid → finalize path.

---

## Build & test (maintainers / CI paths)

From the repo root:

```bash
yarn install           # toolchain deps + scripts
yarn check:config      # optional: Arcium.toml vs bundled IDL vs CI vs web/.env.local
arcium build          # Rust program + Arcis artifacts
arcium test           # Anchor-style integration suite
```

To refresh bundled IDL/types/circuits for the web app:

```bash
arcium build && cd web && yarn copy:artifacts
```

Requires Node **≥ 20.18** (see repo `engines` / `web/.nvmrc`). Prefer a current **Node 22** runtime when running `yarn init:mxe-circuits` so toolchain warnings stay minimal.

Pushes to **`main`** run **GitHub Actions** over `web` (`yarn build`).

---

## Devnet checklist (program → MXE circuits → frontend)

Rough order:

1. **`arcium build`** — Generates `target/idl`, `target/types`, **`build/*.arcis`**.
2. **`arcium deploy`** (Devnet target in your `.env`/CLI config) — Publishes the Anchor program + Arcium MXE wiring. **Costs SOL** (program data + rents). Only repeat when upgrading the binary.
3. **`yarn init:mxe-circuits`** — Separate step: uploads the **encrypted circuit blobs** referenced by computation definitions (`place_bid` alone is ~2 MB raw data and can consume **multiple SOL** in rent across many txs on first provisioning). Safe to rerun: comp‑def **`init*`** txs skip once accounts exist.

```bash
# From repo root (after yarn install + arcium build)
export SOLANA_RPC_URL='https://devnet.helius-rpc.com/?api-key=YOUR_API_KEY_HERE'
export SOLANA_KEYPAIR_PATH="$HOME/.config/solana/id.json"   # default; MXE authority must sign

# @arcium-hq/client defaulted to 500 parallel upload txs → public RPC Helius bursts 429.
# This repo lowers the default batch size to 4; reduce further if needed:
export MXE_UPLOAD_PARALLEL=2   # or 1 under heavy limits

yarn init:mxe-circuits
```

Use **any reliable Devnet RPC** (premium providers strongly recommended during uploads). Rotate API keys leaked in logs or chats.

Canonical **demo / reference** identifiers for this checkout (change if you redeploy elsewhere):

| Setting | Reference value |
|---------|----------------|
| **`NEXT_PUBLIC_SHADOW_BID_PROGRAM_ID`** | `J1vKHNDu4gLpMrf4Zwzca74rjJo4Lx5MvgKUU7B7UWN7` |
| **`NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET` (Devnet)** | **`456`** (see `Arcium.toml` `[clusters.devnet]` — use **`0` only for local `arcium localnet`**). |

Mirror these in **`web/.env.local`** for local previews and **Vercel → Environment Variables**.

---

## Deploying the web app (e.g. Vercel)

1. Complete **Devnet checklist** above (IDL + **`build/*.arcis`** uploaded via `yarn init:mxe-circuits`). Keep **`web/lib/idl/shadow_bid.json`** and bundled types in sync (`arcium build` then `web` **`yarn copy:artifacts`**).
2. Set environment variables (Vercel **or** copy from **`web/.env.local.example`** into `web/.env.local`):

   | Variable | Purpose |
   |----------|---------|
   | `NEXT_PUBLIC_SITE_URL` | Public origin (`https://…vercel.app`) for absolute links. |
   | `NEXT_PUBLIC_SOLANA_RPC_URL` | Shared Devnet RPC for every visitor (**same RPC** ⇒ consistent cluster state). |
   | `NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET` | MXE cluster offset — **`456`** for public Devnet in this repo. |
   | `NEXT_PUBLIC_SHADOW_BID_PROGRAM_ID` | Matches `declare_id!` / IDL. |

3. `cd web && yarn install && yarn build` — GitHub Actions runs this on PRs/pushes touching `web`.

---

## Known limitations

- **No minimum bid in-circuit** — Adding one requires threading a plaintext or encrypted floor into the Arcis `place_bid` logic and proving comparison.
- **Multiple bids per wallet** — Allowed; `bid_count` counts transactions, not unique bidders. Under first-price semantics, repeat bids from the same key only replace the encrypted high-water mark if they exceed it.
- **No on-chain payout** — The auction proves who won and the revealed amount (lamports semantics in the ciphertext); escrow and refunds are roadmap items (also noted in-app).

---

## License

See `package.json` (repository root).
