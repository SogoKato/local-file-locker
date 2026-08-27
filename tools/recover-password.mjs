#!/usr/bin/env node
// Recovery CLI for local-file-locker .enc files.
//
// Format (must match lib/crypto.ts and wasm-crypto/src/lib.rs):
//   file = nonce(12 bytes) || ciphertext || auth_tag(16 bytes)
//   key  = SHA-256(password utf8 bytes), used as AES-256-GCM key
//
// This tool takes a password you *think* you typed and brute-forces
// plausible typo variants of it (fat-finger substitutions, dropped/doubled
// keys, transpositions, caps-lock, shift mistakes, ...) until one of them
// successfully authenticates against the file's GCM tag. Because GCM
// verifies a MAC, a successful decrypt is a correct password with
// overwhelming probability -- there are no false positives to sift through.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function printHelp() {
  console.log(`recover-password.mjs - brute-force typo recovery for local-file-locker .enc files

Usage:
  node tools/recover-password.mjs <input.enc> <password-guess> [options]

Options:
  -o, --output <path>       Where to write the recovered plaintext.
                             Default: <input> with trailing .enc stripped
                             (or "<input>.dec" if it has no .enc suffix).
  -w, --wordlist <path>     Extra file of candidate passwords (one per line).
                             Each line is also used as a mutation seed.
  -d, --depth <n>           Number of chained typo mutations to try (default: 2).
  -m, --max <n>             Cap on total candidates to generate (default: 200000).
  -v, --verbose             Print progress and a sample of attempts.
      --dry-run             Only report how many candidates would be tried.
  -h, --help                Show this help.

Example:
  node tools/recover-password.mjs secret.txt.enc pasword -o secret.txt
`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "-o":
      case "--output":
        args.output = argv[++i];
        break;
      case "-w":
      case "--wordlist":
        args.wordlist = argv[++i];
        break;
      case "-d":
      case "--depth":
        args.depth = Number(argv[++i]);
        break;
      case "-m":
      case "--max":
        args.max = Number(argv[++i]);
        break;
      case "-v":
      case "--verbose":
        args.verbose = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      default:
        args._.push(a);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Keyboard model (US QWERTY) for adjacency-based typo generation.
// ---------------------------------------------------------------------------

const ROWS = ["1234567890-=", "qwertyuiop[]", "asdfghjkl;'", "zxcvbnm,./"];
const ROW_X_OFFSET = [0, 0.5, 0.75, 1.25];
const ADJACENT_ROW_THRESHOLD = 0.6;

const SHIFT_MAP = {
  "1": "!", "2": "@", "3": "#", "4": "$", "5": "%", "6": "^", "7": "&",
  "8": "*", "9": "(", "0": ")", "-": "_", "=": "+",
  "[": "{", "]": "}", ";": ":", "'": '"', ",": "<", ".": ">", "/": "?",
  "`": "~", "\\": "|",
};
const UNSHIFT_MAP = Object.fromEntries(
  Object.entries(SHIFT_MAP).map(([k, v]) => [v, k])
);

// baseChar -> { row, index, x }
const KEY_POS = new Map();
ROWS.forEach((row, r) => {
  for (let i = 0; i < row.length; i++) {
    KEY_POS.set(row[i], { row: r, index: i, x: i + ROW_X_OFFSET[r] });
  }
});

// baseChar -> [neighbor base chars]
const NEIGHBORS = new Map();
for (const [ch, pos] of KEY_POS) {
  const neighbors = new Set();
  const row = ROWS[pos.row];
  if (pos.index > 0) neighbors.add(row[pos.index - 1]);
  if (pos.index < row.length - 1) neighbors.add(row[pos.index + 1]);
  for (const dr of [-1, 1]) {
    const r2 = pos.row + dr;
    if (r2 < 0 || r2 >= ROWS.length) continue;
    for (const c2 of ROWS[r2]) {
      const p2 = KEY_POS.get(c2);
      if (Math.abs(p2.x - pos.x) <= ADJACENT_ROW_THRESHOLD) neighbors.add(c2);
    }
  }
  NEIGHBORS.set(ch, [...neighbors]);
}

function baseKeyOf(ch) {
  if (ch >= "a" && ch <= "z") return { base: ch, shifted: false, kind: "letter" };
  if (ch >= "A" && ch <= "Z") return { base: ch.toLowerCase(), shifted: true, kind: "letter" };
  if (UNSHIFT_MAP[ch]) return { base: UNSHIFT_MAP[ch], shifted: true, kind: "symbol" };
  if (KEY_POS.has(ch)) return { base: ch, shifted: false, kind: "symbol" };
  return null; // unknown char (unicode etc.) - leave untouched
}

function applyShiftState(baseChar, shifted, kind) {
  if (kind === "letter") return shifted ? baseChar.toUpperCase() : baseChar;
  return shifted ? SHIFT_MAP[baseChar] ?? baseChar : baseChar;
}

// ---------------------------------------------------------------------------
// Mutation operators
// ---------------------------------------------------------------------------

function wholeStringMutations(s) {
  const out = new Set();
  out.add(s.toLowerCase());
  out.add(s.toUpperCase());
  out.add(s.charAt(0).toUpperCase() + s.slice(1));
  out.add(s.charAt(0).toLowerCase() + s.slice(1));
  out.add(
    [...s]
      .map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()))
      .join("")
  ); // swapcase (e.g. caps-lock-while-shifting mistakes)
  out.add(s.trim());
  out.add(" " + s);
  out.add(s + " ");
  out.delete(s);
  return out;
}

function singleEditMutations(s) {
  const out = new Set();
  const n = s.length;

  for (let i = 0; i < n; i++) {
    // delete char at i (missed keystroke)
    out.add(s.slice(0, i) + s.slice(i + 1));
    // duplicate char at i (double keystroke)
    out.add(s.slice(0, i + 1) + s[i] + s.slice(i + 1));
    // toggle case / shift state of a single char
    const info = baseKeyOf(s[i]);
    if (info) {
      const toggled = applyShiftState(info.base, !info.shifted, info.kind);
      if (toggled !== s[i]) out.add(s.slice(0, i) + toggled + s.slice(i + 1));

      // substitute with an adjacent key (same shift state)
      for (const nb of NEIGHBORS.get(info.base) ?? []) {
        const nbChar = applyShiftState(nb, info.shifted, info.kind === "letter" ? "letter" : "symbol");
        out.add(s.slice(0, i) + nbChar + s.slice(i + 1));
        // insert the neighbor before/after (accidental extra keystroke)
        out.add(s.slice(0, i) + nbChar + s.slice(i));
        out.add(s.slice(0, i + 1) + nbChar + s.slice(i + 1));
      }
    }
    // adjacent transposition
    if (i < n - 1) {
      out.add(s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2));
    }
  }

  out.delete(s);
  return out;
}

function generateCandidates(seeds, depth, max) {
  const all = new Set(seeds);
  let frontier = new Set(seeds);

  for (const seed of [...seeds]) {
    for (const m of wholeStringMutations(seed)) {
      if (all.size >= max) break;
      if (!all.has(m)) {
        all.add(m);
        frontier.add(m);
      }
    }
  }

  for (let d = 0; d < depth && all.size < max; d++) {
    const next = new Set();
    for (const c of frontier) {
      for (const m of singleEditMutations(c)) {
        if (all.size >= max) break;
        if (!all.has(m)) {
          all.add(m);
          next.add(m);
        }
      }
      if (all.size >= max) break;
    }
    frontier = next;
    if (frontier.size === 0) break;
  }

  return all;
}

// ---------------------------------------------------------------------------
// Decryption (must match wasm-crypto/src/lib.rs::decrypt)
// ---------------------------------------------------------------------------

function tryDecrypt(password, fileBuffer) {
  const key = crypto.createHash("sha256").update(password, "utf8").digest();
  const nonce = fileBuffer.subarray(0, 12);
  const rest = fileBuffer.subarray(12);
  if (rest.length < 16) return null;
  const tag = rest.subarray(rest.length - 16);
  const ciphertext = rest.subarray(0, rest.length - 16);
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args._.length < 2) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const [inputPath, passwordGuess] = args._;
  const depth = Number.isFinite(args.depth) ? args.depth : 2;
  const max = Number.isFinite(args.max) ? args.max : 200_000;

  let fileBuffer;
  try {
    fileBuffer = fs.readFileSync(inputPath);
  } catch (e) {
    console.error(`failed to read input file: ${e.message}`);
    process.exit(1);
  }
  if (fileBuffer.length < 12 + 16) {
    console.error("input file is too short to be a valid .enc file (need at least 28 bytes)");
    process.exit(1);
  }

  const seeds = new Set([passwordGuess]);
  if (args.wordlist) {
    const lines = fs.readFileSync(args.wordlist, "utf8").split(/\r?\n/).filter(Boolean);
    for (const l of lines) seeds.add(l);
  }

  console.error(`generating candidates (seeds=${seeds.size}, depth=${depth}, max=${max})...`);
  const candidates = generateCandidates(seeds, depth, max);
  // Try the untouched seeds first, then everything else.
  const ordered = [...seeds, ...candidates].filter((c, i, arr) => arr.indexOf(c) === i);

  console.error(`generated ${ordered.length} candidate password(s).`);
  if (args.dryRun) {
    process.exit(0);
  }

  const start = Date.now();
  let tried = 0;
  for (const candidate of ordered) {
    tried++;
    if (args.verbose && tried % 5000 === 0) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.error(`  ...tried ${tried}/${ordered.length} (${elapsed}s)`);
    }
    const plain = tryDecrypt(candidate, fileBuffer);
    if (plain !== null) {
      const outputPath =
        args.output ??
        (inputPath.endsWith(".enc") ? inputPath.slice(0, -4) : `${inputPath}.dec`);
      fs.writeFileSync(outputPath, plain);
      console.log(`SUCCESS after ${tried} attempt(s).`);
      console.log(`recovered password: ${JSON.stringify(candidate)}`);
      console.log(`plaintext written to: ${path.resolve(outputPath)}`);
      process.exit(0);
    }
  }

  console.error(`no candidate matched after ${tried} attempt(s).`);
  console.error("try increasing --depth/--max, or supply more seeds via --wordlist.");
  process.exit(2);
}

main();
