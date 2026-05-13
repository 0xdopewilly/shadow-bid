"use client";

import { Clock, Loader2, Lock, Timer } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

interface Props {
  /** Unix seconds. 0 / null = no deadline set on-chain. */
  biddingEndsAtUnixSec: number | null;
  /** Whether the user is the auction authority (only they can set the deadline). */
  canSet: boolean;
  /** Whether RPC + wallet are ready for the on-chain set call. */
  canCallChain: boolean;
  /** Notified when the timer hits zero (transitions from running -> ended). */
  onEnded?: () => void;
  /** Authority-only: lock an immutable on-chain deadline. */
  onSetDeadline?: (unixSec: number) => Promise<void>;
  className?: string;
}

/** Minutes slider when unit === "m"; hours when "h". */
const MIN_MINUTES = 5;
const MAX_MINUTES = 10080; // 7 days
const MIN_HOURS = 1;
const MAX_HOURS = 168; // 7 days

function formatCountdown(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const totalS = Math.floor(ms / 1000);
  const d = Math.floor(totalS / 86_400);
  const h = Math.floor((totalS % 86_400) / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS % 60;
  if (d > 0)
    return `${d}d ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function EpochTimer({
  biddingEndsAtUnixSec,
  canSet,
  canCallChain,
  onEnded,
  onSetDeadline,
  className = "",
}: Props) {
  const endMs =
    biddingEndsAtUnixSec && biddingEndsAtUnixSec > 0
      ? biddingEndsAtUnixSec * 1000
      : null;

  const [unit, setUnit] = useState<"m" | "h">("m");
  const [sliderVal, setSliderVal] = useState(60); // 60 minutes default
  const [remaining, setRemaining] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [endedFiredFor, setEndedFiredFor] = useState<number | null>(null);

  const min = unit === "m" ? MIN_MINUTES : MIN_HOURS;
  const max = unit === "m" ? MAX_MINUTES : MAX_HOURS;

  const durationMs = useMemo(() => {
    if (unit === "m") return sliderVal * 60_000;
    return sliderVal * 3_600_000;
  }, [unit, sliderVal]);

  const durationLabel = useMemo(() => {
    if (unit === "m") {
      if (sliderVal < 60) return `${sliderVal} min`;
      const h = Math.floor(sliderVal / 60);
      const m = sliderVal % 60;
      return m ? `${h}h ${m}m` : `${h}h`;
    }
    if (sliderVal === 1) return `1 hour`;
    if (sliderVal < 24) return `${sliderVal} hours`;
    const d = Math.floor(sliderVal / 24);
    const h = sliderVal % 24;
    return h ? `${d}d ${h}h` : `${d} days`;
  }, [unit, sliderVal]);

  useEffect(() => {
    if (endMs == null) {
      setRemaining(0);
      return;
    }
    const tick = () => {
      const r = endMs - Date.now();
      setRemaining(r);
      if (r <= 0 && endedFiredFor !== endMs) {
        setEndedFiredFor(endMs);
        onEnded?.();
        clearInterval(id);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endMs, onEnded, endedFiredFor]);

  const applyDeadline = useCallback(async () => {
    if (!onSetDeadline) return;
    const unixSec = Math.floor((Date.now() + durationMs) / 1000);
    setBusy(true);
    try {
      await onSetDeadline(unixSec);
    } finally {
      setBusy(false);
    }
  }, [onSetDeadline, durationMs]);

  const ended = endMs != null && remaining <= 0;
  const running = endMs != null && remaining > 0;
  const locked = endMs != null;

  return (
    <div
      className={`rounded-2xl border border-white/[0.08] bg-black/30 p-4 backdrop-blur-md ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-violet-200">
          <Timer className="h-4 w-4" />
          Bidding window
          {locked ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-violet-200">
              <Lock className="h-2.5 w-2.5" />
              on-chain · immutable
            </span>
          ) : null}
        </div>
        {running ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-mono text-emerald-200">
            <Clock className="h-3 w-3" />
            <span suppressHydrationWarning>{formatCountdown(remaining)}</span>
          </span>
        ) : ended ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia-500/35 bg-fuchsia-500/10 px-2.5 py-1 text-xs font-bold uppercase tracking-widest text-fuchsia-200">
            ended · ready to reveal
          </span>
        ) : (
          <span className="text-[11px] text-slate-500">no deadline set</span>
        )}
      </div>

      {locked ? (
        <p className="mt-2 text-[11px] text-slate-500">
          Closes{" "}
          <span suppressHydrationWarning className="text-slate-300">
            {endMs ? new Date(endMs).toLocaleString() : ""}
          </span>
          . The program rejects <code className="text-slate-400">place_bid</code> after
          that instant.
        </p>
      ) : canSet ? (
        <div className="mt-4 space-y-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500">Duration from now:</span>
            <div className="inline-flex rounded-lg border border-white/10 bg-black/30 p-0.5">
              <button
                type="button"
                onClick={() => {
                  setUnit("m");
                  setSliderVal((v) => {
                    const mins =
                      unit === "h"
                        ? Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, v * 60))
                        : Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, v));
                    return mins;
                  });
                }}
                className={`rounded-md px-2 py-0.5 ${
                  unit === "m" ? "bg-violet-500/25 text-violet-100" : "text-slate-500"
                }`}
              >
                Minutes
              </button>
              <button
                type="button"
                onClick={() => {
                  setUnit("h");
                  setSliderVal((v) => {
                    const asHours =
                      unit === "m"
                        ? Math.max(1, Math.round(v / 60))
                        : Math.max(MIN_HOURS, Math.min(MAX_HOURS, v));
                    return Math.max(MIN_HOURS, Math.min(MAX_HOURS, asHours));
                  });
                }}
                className={`rounded-md px-2 py-0.5 ${
                  unit === "h" ? "bg-violet-500/25 text-violet-100" : "text-slate-500"
                }`}
              >
                Hours
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="range"
              min={min}
              max={max}
              step={1}
              value={Math.min(max, Math.max(min, sliderVal))}
              onChange={(e) => setSliderVal(Number(e.target.value))}
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-white/10 accent-violet-500"
            />
            <span className="min-w-[6.5rem] text-right font-mono text-sm text-violet-200">
              {durationLabel}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={min}
              max={max}
              value={sliderVal}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n))
                  setSliderVal(Math.min(max, Math.max(min, Math.floor(n))));
              }}
              className="w-20 rounded-md border border-white/10 bg-black/40 px-2 py-1 font-mono text-slate-200"
            />
            <span className="text-slate-500">{unit === "m" ? "minutes" : "hours"}</span>
            {busy ? (
              <span className="inline-flex items-center gap-1 text-violet-300">
                <Loader2 className="h-3 w-3 animate-spin" />
                writing…
              </span>
            ) : (
              <button
                type="button"
                disabled={!canCallChain}
                onClick={() => void applyDeadline()}
                className="ml-auto rounded-lg border border-violet-400/40 bg-violet-500/15 px-3 py-1 font-semibold text-violet-100 hover:bg-violet-500/25 disabled:opacity-50"
              >
                Lock on-chain
              </button>
            )}
          </div>
          <p className="text-[10px] text-slate-500">
            Calls{" "}
            <code className="text-slate-400">set_auction_deadline</code>. One shot — no
            edits after you lock.
          </p>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-slate-500">
          Only the auction authority can lock the deadline.
        </p>
      )}
    </div>
  );
}
