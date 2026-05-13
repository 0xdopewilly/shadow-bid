/**
 * Install ShadowBid MXE computation definitions + upload .arcis blobs.
 *
 * On `arcium localnet`, only the MXE authority may init these — that keypair
 * is your Solana CLI default (~/.config/solana/id.json), NOT your Phantom
 * wallet unless you imported that exact key into Phantom.
 *
 * Usage (localnet / Docker running, validator on 8899):
 *   yarn init:mxe-circuits
 *
 * Env:
 *   SOLANA_RPC_URL        (default http://127.0.0.1:8899)
 *   SOLANA_KEYPAIR_PATH   (default ~/.config/solana/id.json)
 */
import * as anchor from "@coral-xyz/anchor";
import { Idl, Program } from "@coral-xyz/anchor";
import {
  getArciumAccountBaseSeed,
  getArciumProgram,
  getArciumProgramId,
  getCompDefAccOffset,
  getLookupTableAddress,
  getMXEAccAddress,
  uploadCircuit,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PublicKey } from "@solana/web3.js";
import type { ShadowBid } from "../target/types/shadow_bid";

const RPC = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
const KEYPAIR_PATH =
  process.env.SOLANA_KEYPAIR_PATH ??
  path.join(os.homedir(), ".config/solana/id.json");

const CIRCUITS = [
  "init_auction_state",
  "place_bid",
  "reveal_winner",
] as const;

function loadKeypair(p: string): anchor.web3.Keypair {
  const secret = JSON.parse(fs.readFileSync(p, "utf8"));
  return anchor.web3.Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function main() {
  const kp = loadKeypair(KEYPAIR_PATH);
  const wallet = new anchor.Wallet(kp);
  const connection = new anchor.web3.Connection(RPC, "confirmed");
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  const repoRoot = path.resolve(__dirname, "..");
  const idlPath = path.join(repoRoot, "target/idl/shadow_bid.json");
  if (!fs.existsSync(idlPath)) {
    throw new Error(
      `Missing ${idlPath} — run \`arcium build\` from the repo root first.`
    );
  }
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8")) as Idl;
  const program = new Program(idl, provider) as Program<ShadowBid>;

  console.log(`RPC:        ${RPC}`);
  console.log(`Authority:  ${wallet.publicKey.toBase58()} (${KEYPAIR_PATH})`);
  console.log(`Program:    ${program.programId.toBase58()}`);

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

  for (const circuitName of CIRCUITS) {
    const baseSeedCompDefAcc = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount"
    );
    const offsetBytes = getCompDefAccOffset(circuitName);
    const compDefPda = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, program.programId.toBuffer(), offsetBytes],
      getArciumProgramId()
    )[0];

    process.stdout.write(`→ ${circuitName} (on-chain init)… `);
    if (circuitName === "init_auction_state") {
      await program.methods
        .initAuctionStateCompDef()
        .accounts({
          compDefAccount: compDefPda,
          payer: wallet.publicKey,
          mxeAccount,
          addressLookupTable: lutAddress,
        })
        .rpc(rpcOpts);
    } else if (circuitName === "place_bid") {
      await program.methods
        .initPlaceBidCompDef()
        .accounts({
          compDefAccount: compDefPda,
          payer: wallet.publicKey,
          mxeAccount,
          addressLookupTable: lutAddress,
        })
        .rpc(rpcOpts);
    } else {
      await program.methods
        .initRevealWinnerCompDef()
        .accounts({
          compDefAccount: compDefPda,
          payer: wallet.publicKey,
          mxeAccount,
          addressLookupTable: lutAddress,
        })
        .rpc(rpcOpts);
    }
    console.log("ok");

    const arcisPath = path.join(repoRoot, `build/${circuitName}.arcis`);
    if (!fs.existsSync(arcisPath)) {
      throw new Error(
        `Missing ${arcisPath} — run \`arcium build\` from the repo root.`
      );
    }
    process.stdout.write(`→ ${circuitName} (upload .arcis)… `);
    const raw = new Uint8Array(fs.readFileSync(arcisPath));
    await uploadCircuit(provider, circuitName, program.programId, raw, false);
    console.log("ok");
  }

  console.log("\nDone — all MXE circuits installed. Use Phantom in the dApp for create/bid.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
