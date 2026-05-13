import { Buffer } from "buffer";

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

export function randomComputationOffsetLE(): Buffer {
  return Buffer.from(randomBytes(8));
}
