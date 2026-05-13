import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import type { ShadowBid } from "../target/types/shadow_bid";
import { randomBytes } from "crypto";
import {
  awaitComputationFinalization,
  getArciumEnv,
  getCompDefAccOffset,
  RescueCipher,
  deserializeLE,
  getMXEPublicKey,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  getArciumAccountBaseSeed,
  getArciumProgramId,
  uploadCircuit,
  getLookupTableAddress,
  getArciumProgram,
  x25519,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import { expect } from "chai";

async function getMXEPublicKeyWithRetry(
  provider: anchor.AnchorProvider,
  programId: PublicKey,
  maxRetries = 20,
  retryDelayMs = 500
): Promise<Uint8Array> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const key = await getMXEPublicKey(provider, programId, "confirmed");
      if (key) return key;
    } catch {
      /* retry */
    }
    if (attempt === maxRetries)
      throw new Error("Failed to fetch MXE public key");
    await new Promise((r) => setTimeout(r, retryDelayMs));
  }
  throw new Error("unreachable");
}

function readKpJson(path: string): anchor.web3.Keypair {
  const secret = JSON.parse(fs.readFileSync(path, "utf8"));
  return anchor.web3.Keypair.fromSecretKey(Uint8Array.from(secret));
}

/** Split 32-byte pubkey into two u128 limbs (little-endian), matching Arcis `SerializedSolanaPublicKey`. */
function splitPubkeyToU128s(pubkey: Uint8Array): { lo: bigint; hi: bigint } {
  const loBytes = pubkey.slice(0, 16);
  const hiBytes = pubkey.slice(16, 32);
  return { lo: deserializeLE(loBytes), hi: deserializeLE(hiBytes) };
}

describe("shadow_bid (Arcium blind auction)", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.ShadowBid as Program<ShadowBid>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  type Event = anchor.IdlEvents<(typeof program)["idl"]>;

  const awaitEvent = async <E extends keyof Event>(
    eventName: E,
    auctionKey?: PublicKey,
    timeoutMs = 120000
  ): Promise<Event[E]> => {
    let listenerId: number;
    let timeoutId: NodeJS.Timeout;
    const event = await new Promise<Event[E]>((res, rej) => {
      listenerId = program.addEventListener(
        eventName,
        (ev: Record<string, unknown>) => {
          if (
            auctionKey &&
            ev.auction instanceof PublicKey &&
            !ev.auction.equals(auctionKey)
          )
            return;
          clearTimeout(timeoutId);
          res(ev as Event[E]);
        }
      );
      timeoutId = setTimeout(() => {
        program.removeEventListener(listenerId);
        rej(new Error(`Event ${String(eventName)} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    await program.removeEventListener(listenerId);
    return event;
  };

  const arciumEnv = getArciumEnv();
  const clusterAccount = getClusterAccAddress(arciumEnv.arciumClusterOffset);

  let owner: anchor.web3.Keypair;
  let mxePublicKey: Uint8Array;

  async function initCompDef(circuitName: string): Promise<void> {
    const baseSeedCompDefAcc = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount"
    );
    const offset = getCompDefAccOffset(circuitName);
    const compDefPDA = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
      getArciumProgramId()
    )[0];

    const arciumProgram = getArciumProgram(provider);
    const mxeAccount = getMXEAccAddress(program.programId);
    const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
    const lutAddress = getLookupTableAddress(
      program.programId,
      mxeAcc.lutOffsetSlot
    );

    let sig: string;
    switch (circuitName) {
      case "init_auction_state":
        sig = await program.methods
          .initAuctionStateCompDef()
          .accounts({
            compDefAccount: compDefPDA,
            payer: owner.publicKey,
            mxeAccount,
            addressLookupTable: lutAddress,
          })
          .signers([owner])
          .rpc({ preflightCommitment: "confirmed", commitment: "confirmed" });
        break;
      case "place_bid":
        sig = await program.methods
          .initPlaceBidCompDef()
          .accounts({
            compDefAccount: compDefPDA,
            payer: owner.publicKey,
            mxeAccount,
            addressLookupTable: lutAddress,
          })
          .signers([owner])
          .rpc({ preflightCommitment: "confirmed", commitment: "confirmed" });
        break;
      default:
        throw new Error(`Unknown circuit: ${circuitName}`);
    }

    const rawCircuit = fs.readFileSync(`build/${circuitName}.arcis`);
    await uploadCircuit(
      provider,
      circuitName,
      program.programId,
      rawCircuit,
      true
    );
    void sig;
  }

  before(async () => {
    owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);
    mxePublicKey = await getMXEPublicKeyWithRetry(provider, program.programId);
    await initCompDef("init_auction_state");
    await initCompDef("place_bid");
  });

  it("creates auction and accepts an encrypted bid", async () => {
    const createComputationOffset = new anchor.BN(randomBytes(8), "hex");
    const lid = Buffer.alloc(8);
    lid.writeBigUInt64LE(BigInt(0), 0);
    const [auctionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("auction"), owner.publicKey.toBuffer(), lid],
      program.programId
    );

    const createdPromise = awaitEvent("auctionCreatedEvent", auctionPda);

    await program.methods
      .createAuction(
        createComputationOffset,
        new anchor.BN(0),
        "ShadowBid test lot",
        "Sealed-bid integration test auction.",
        ""
      )
      .accountsPartial({
        authority: owner.publicKey,
        auction: auctionPda,
        computationAccount: getComputationAccAddress(
          arciumEnv.arciumClusterOffset,
          createComputationOffset
        ),
        clusterAccount,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("init_auction_state")).readUInt32LE()
        ),
      })
      .rpc({ commitment: "confirmed", skipPreflight: true });

    await awaitComputationFinalization(
      provider,
      createComputationOffset,
      program.programId,
      "confirmed"
    );
    await createdPromise;

    const privateKey = x25519.utils.randomSecretKey();
    const ephemeralPubkey = x25519.getPublicKey(privateKey);
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    const bidAmount = BigInt(42);
    const { lo: bidderLo, hi: bidderHi } = splitPubkeyToU128s(
      owner.publicKey.toBytes()
    );

    const nonceBid = randomBytes(16);
    const nonceBidder = randomBytes(16);
    const ctBid = cipher.encrypt([bidAmount], nonceBid);
    const ctBidder = cipher.encrypt([bidderLo, bidderHi], nonceBidder);

    const bidComputationOffset = new anchor.BN(randomBytes(8), "hex");
    const bidPlacedPromise = awaitEvent("bidPlacedEvent", auctionPda);

    await program.methods
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
        bidder: owner.publicKey,
        auction: auctionPda,
        computationAccount: getComputationAccAddress(
          arciumEnv.arciumClusterOffset,
          bidComputationOffset
        ),
        clusterAccount,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
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

    const bidEv = await bidPlacedPromise;
    expect(bidEv.bidCount).to.equal(1);
  });
});
