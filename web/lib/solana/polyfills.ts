import { Buffer } from "buffer";

export function installBufferPolyfill(): void {
  if (typeof window === "undefined") return;
  const g = window as typeof window & { Buffer?: typeof Buffer };
  if (!g.Buffer) {
    g.Buffer = Buffer;
  }
}
