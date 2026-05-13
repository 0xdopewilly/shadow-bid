"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Bell, BellOff, ShieldAlert, X } from "lucide-react";

export type ToastKind = "info" | "outbid" | "warn";

export type Toast = {
  id: string;
  kind: ToastKind;
  title: string;
  body?: string;
  ts: number;
};

interface Props {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

const KIND_STYLES: Record<ToastKind, { icon: typeof Bell; cls: string }> = {
  info: {
    icon: Bell,
    cls: "border-violet-400/35 bg-violet-500/10 text-violet-100",
  },
  outbid: {
    icon: ShieldAlert,
    cls: "border-fuchsia-400/40 bg-fuchsia-500/10 text-fuchsia-100",
  },
  warn: {
    icon: BellOff,
    cls: "border-amber-400/35 bg-amber-500/10 text-amber-100",
  },
};

export function ToastStack({ toasts, onDismiss }: Props) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.slice(0, 4).map((t) => {
          const k = KIND_STYLES[t.kind];
          const Icon = k.icon;
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 60, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 60, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 360, damping: 30 }}
              className={`pointer-events-auto rounded-2xl border ${k.cls} backdrop-blur-md p-3 shadow-[0_8px_30px_rgba(0,0,0,0.45)]`}
            >
              <div className="flex items-start gap-2">
                <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-tight">
                    {t.title}
                  </p>
                  {t.body ? (
                    <p className="mt-1 text-xs opacity-90 leading-snug">
                      {t.body}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => onDismiss(t.id)}
                  className="rounded-md p-1 text-white/70 hover:bg-white/10"
                  title="Dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
