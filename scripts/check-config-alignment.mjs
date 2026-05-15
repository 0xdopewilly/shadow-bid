#!/usr/bin/env node
/**
 * Fail fast when Arcium devnet offset, bundled IDL program id, Anchor localnet id,
 * GitHub Actions web env, and web/.env.local drift apart.
 *
 * Usage (repo root): node scripts/check-config-alignment.mjs
 *                    yarn check:config
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function readUtf8(p) {
  return fs.readFileSync(p, "utf8");
}

function parseArciumDevnetOffset(toml) {
  const i = toml.indexOf("[clusters.devnet]");
  if (i === -1) return null;
  const slice = toml.slice(i, i + 800);
  const m = slice.match(/offset\s*=\s*(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function parseAnchorShadowBidProgram(anchorToml) {
  const lines = anchorToml.split(/\r?\n/);
  let inLocalnet = false;
  for (const line of lines) {
    const s = line.trim();
    if (s.startsWith("[") && s.endsWith("]")) {
      inLocalnet = s === "[programs.localnet]";
      continue;
    }
    if (!inLocalnet) continue;
    const m = s.match(/^shadow_bid\s*=\s*"([^"]+)"/);
    if (m) return m[1];
    if (s.startsWith("[") && s.endsWith("]")) break;
  }
  return null;
}

function parseWorkflow(webCiYml) {
  const offset = webCiYml.match(
    /NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET:\s*"(\d+)"/
  );
  const pid = webCiYml.match(
    /NEXT_PUBLIC_SHADOW_BID_PROGRAM_ID:\s*([1-9A-HJ-NP-Za-km-z]{32,44})\b/
  );
  return {
    offset: offset ? parseInt(offset[1], 10) : null,
    programId: pid ? pid[1].trim() : null,
  };
}

function parseEnvLocal(content) {
  const out = {};
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (t.startsWith("#") || !t.includes("=")) continue;
    const eq = t.indexOf("=");
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key === "NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET") {
      const n = parseInt(val, 10);
      if (!Number.isNaN(n)) out.offset = n;
    }
    if (key === "NEXT_PUBLIC_SHADOW_BID_PROGRAM_ID") out.programId = val;
  }
  return out;
}

function idlAddress(idlPath) {
  const j = JSON.parse(readUtf8(idlPath));
  return typeof j.address === "string" ? j.address : null;
}

const arciumPath = path.join(root, "Arcium.toml");
const anchorPath = path.join(root, "Anchor.toml");
const idlPath = path.join(root, "web/lib/idl/shadow_bid.json");
const wfPath = path.join(root, ".github/workflows/web-ci.yml");
const envPath = path.join(root, "web/.env.local");

let exitCode = 0;
const failures = [];

if (!fs.existsSync(idlPath)) {
  console.error(
    "Missing web/lib/idl/shadow_bid.json — run: arcium build && cd web && yarn copy:artifacts"
  );
  process.exit(1);
}

const arciumOffset = parseArciumDevnetOffset(readUtf8(arciumPath));
const anchorProg = parseAnchorShadowBidProgram(readUtf8(anchorPath));
const idlProg = idlAddress(idlPath);

if (arciumOffset == null)
  failures.push("Arcium.toml: missing [clusters.devnet] offset");
if (!idlProg) failures.push("IDL: missing address field");
if (anchorProg && idlProg && anchorProg !== idlProg) {
  failures.push(
    `Program ID mismatch: Anchor.toml [programs.localnet].shadow_bid (${anchorProg}) ≠ web/lib/idl (${idlProg})`
  );
  exitCode = 1;
}

if (fs.existsSync(wfPath)) {
  const wf = parseWorkflow(readUtf8(wfPath));
  if (
    wf.offset != null &&
    arciumOffset != null &&
    wf.offset !== arciumOffset
  ) {
    failures.push(
      `.github/workflows/web-ci.yml NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET (${wf.offset}) ≠ Arcium.toml devnet (${arciumOffset})`
    );
    exitCode = 1;
  }
  if (wf.programId && idlProg && wf.programId !== idlProg) {
    failures.push(
      `.github/workflows/web-ci.yml NEXT_PUBLIC_SHADOW_BID_PROGRAM_ID ≠ IDL (${idlProg})`
    );
    exitCode = 1;
  }
}

if (fs.existsSync(envPath)) {
  const env = parseEnvLocal(readUtf8(envPath));
  if (
    env.offset != null &&
    arciumOffset != null &&
    env.offset !== arciumOffset
  ) {
    failures.push(
      `web/.env.local NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET (${env.offset}) ≠ Arcium.toml (${arciumOffset})`
    );
    exitCode = 1;
  }
  if (env.programId && idlProg && env.programId !== idlProg) {
    failures.push(
      `web/.env.local NEXT_PUBLIC_SHADOW_BID_PROGRAM_ID (${env.programId}) ≠ IDL (${idlProg})`
    );
    exitCode = 1;
  }
}

console.log("ShadowBid config alignment\n");
console.log(`  Arcium.toml [clusters.devnet].offset     ${arciumOffset ?? "(missing)"}`);
console.log(`  web/lib/idl/shadow_bid.json \"address\"  ${idlProg ?? "(missing)"}`);
console.log(`  Anchor.toml [programs.localnet]        ${anchorProg ?? "(missing)"}`);
if (fs.existsSync(wfPath)) {
  const wf = parseWorkflow(readUtf8(wfPath));
  console.log(
    `  web-ci.yml NEXT_PUBLIC_*                 offset ${wf.offset ?? "?"}, program ${wf.programId ?? "?"}`
  );
}
if (fs.existsSync(envPath)) {
  const env = parseEnvLocal(readUtf8(envPath));
  console.log(
    `  web/.env.local                           offset ${env.offset ?? "?"}, program ${env.programId ?? "?"}`
  );
}

if (failures.length) {
  console.error("\nMismatches:");
  for (const f of failures) console.error(`  • ${f}`);
  console.error(
    "\nFix: set NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET from Arcium.toml [clusters.devnet].offset (must also match `arcium deploy -o`). Set NEXT_PUBLIC_SHADOW_BID_PROGRAM_ID from IDL after deploy."
  );
  process.exit(exitCode || 1);
}

console.log("\n✓ Sources agree (Arcium.toml, IDL, Anchor localnet, CI, web/.env.local if present).");
