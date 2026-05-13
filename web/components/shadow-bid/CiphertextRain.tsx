"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const HEX = "0123456789ABCDEF";

function pickHex(n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) {
    out += HEX[Math.floor(Math.random() * 16)];
  }
  return out;
}

function bytesToHex(bytes: Uint8Array | null): string {
  if (!bytes || bytes.length === 0) return "";
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out.toUpperCase();
}

type Column = {
  glyphs: string[];
  speed: number;
  hot: number;
};

interface Props {
  /** real on-chain encrypted state bytes if available — used as a seed/anchor row */
  realBytes?: Uint8Array | null;
  /** number of columns (width) */
  cols?: number;
  /** rows visible per column */
  rows?: number;
  /** animation tick in ms */
  tickMs?: number;
  className?: string;
  /** if true, the visualizer pauses (e.g. during reveal) */
  paused?: boolean;
}

/**
 * Matrix-rain style ciphertext visualizer.
 *
 * Frames the real on-chain `encrypted_state` bytes (if provided) as the
 * "true" hidden row, and continuously scrambles random hex around it so
 * spectators get a felt sense that a value exists but is sealed.
 */
export function CiphertextRain({
  realBytes,
  cols = 28,
  rows = 7,
  tickMs = 110,
  className = "",
  paused = false,
}: Props) {
  const initial = useMemo<Column[]>(
    () =>
      Array.from({ length: cols }, () => ({
        glyphs: Array.from({ length: rows }, () => pickHex(2)),
        speed: 0.5 + Math.random() * 1.2,
        hot: Math.floor(Math.random() * rows),
      })),
    [cols, rows]
  );
  const colsRef = useRef<Column[]>(initial);
  const [, force] = useState(0);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      const cs = colsRef.current;
      for (let c = 0; c < cs.length; c++) {
        const col = cs[c];
        if (Math.random() < 0.5 * col.speed) {
          col.glyphs.unshift(pickHex(2));
          col.glyphs.pop();
        }
        if (Math.random() < 0.08) col.hot = (col.hot + 1) % col.glyphs.length;
      }
      force((n) => (n + 1) % 1_000_000);
    }, tickMs);
    return () => clearInterval(id);
  }, [tickMs, paused]);

  const realHex = useMemo(() => bytesToHex(realBytes ?? null), [realBytes]);
  const realRow = useMemo(() => {
    if (!realHex) return null;
    const slice = realHex.slice(0, cols * 2);
    const out: string[] = [];
    for (let i = 0; i < cols; i++) out.push(slice.slice(i * 2, i * 2 + 2) || "··");
    return out;
  }, [realHex, cols]);

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-violet-500/25 bg-black/55 p-3 sm:p-4 ${className}`}
      aria-hidden="true"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(ellipse at 50% 0%, rgba(139,92,246,0.35), transparent 60%), radial-gradient(ellipse at 50% 100%, rgba(192,38,211,0.25), transparent 60%)",
        }}
      />
      <div
        className="relative grid font-mono text-[11px] sm:text-xs leading-tight tracking-widest text-violet-300/70"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {colsRef.current.map((col, ci) => (
          <div key={ci} className="flex flex-col items-center gap-0.5">
            {col.glyphs.map((g, ri) => {
              const isHot = ri === col.hot;
              const fade = 1 - (ri / col.glyphs.length) * 0.85;
              return (
                <span
                  key={ri}
                  className={
                    isHot
                      ? "text-fuchsia-200 drop-shadow-[0_0_6px_rgba(232,121,249,0.75)]"
                      : ""
                  }
                  style={{ opacity: isHot ? 1 : fade }}
                  suppressHydrationWarning
                >
                  {g}
                </span>
              );
            })}
          </div>
        ))}
      </div>

      <div className="relative mt-3 border-t border-violet-500/15 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] uppercase tracking-[0.18em] text-violet-300/70">
          <span>encrypted_state[0..{realHex ? Math.min(cols, realHex.length / 2) : cols}]</span>
          <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-violet-200">
            sealed · MXE only
          </span>
        </div>
        <div className="mt-1.5 grid gap-x-1 font-mono text-[10px] sm:text-xs text-violet-200/95"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {realRow
            ? realRow.map((b, i) => (
                <span key={i} className="text-center" suppressHydrationWarning>
                  {b}
                </span>
              ))
            : Array.from({ length: cols }).map((_, i) => (
                <span key={i} className="text-center text-violet-300/30" suppressHydrationWarning>
                  ··
                </span>
              ))}
        </div>
      </div>
    </div>
  );
}
