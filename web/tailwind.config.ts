import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-syne)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        void: "#030008",
        nebula: "#0a0618",
        iris: "#6366f1",
        violet: "#8b5cf6",
        fuchsia: "#c026d3",
      },
      backgroundImage: {
        "grid-fade":
          "linear-gradient(to bottom, transparent 0%, rgba(3,0,8,0.9) 100%), linear-gradient(90deg, rgba(139,92,246,0.03) 1px, transparent 1px), linear-gradient(rgba(139,92,246,0.03) 1px, transparent 1px)",
      },
      boxShadow: {
        glass: "0 8px 32px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.06)",
        "glass-lg":
          "0 24px 80px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(139, 92, 246, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.08)",
        neon: "0 0 20px rgba(139, 92, 246, 0.45), 0 0 40px rgba(99, 102, 241, 0.25)",
        "neon-strong":
          "0 0 24px rgba(192, 38, 211, 0.55), 0 0 48px rgba(139, 92, 246, 0.35)",
      },
      animation: {
        "pulse-slow": "pulse-glow 4s ease-in-out infinite",
        shimmer: "shimmer 8s linear infinite",
      },
      keyframes: {
        "pulse-glow": {
          "0%, 100%": { opacity: "0.5" },
          "50%": { opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
