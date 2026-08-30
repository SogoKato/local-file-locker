#!/usr/bin/env node
// Recovery CLI for local-file-locker .enc/.lfl files. Supports two formats
// (must match lib/crypto.ts and lib/vault.ts):
//
// v1 (legacy .enc, no header):
//   file = nonce(12 bytes) || ciphertext || auth_tag(16 bytes)
//   key  = SHA-256(password utf8 bytes), no salt, no AAD
//
// v2 container (.lfl, exported from the app's main vault):
//   file   = magic("LFLF") || version(1) || opaqueId(36) || contentFormat(1)
//            || nameBlobLen(4, BE) || nameBlob || contentBlob
//   blob   = magic("LFL2") || salt(16) || iterations(4, BE) || nonce(12)
//            || ciphertext_and_tag
//   key    = PBKDF2-HMAC-SHA256(password utf8 bytes, salt, iterations, 32 bytes)
//   aad    = "LFAD" || aadVersion(1) || roleTag(1: 0x01=name, 0x02=content) || opaqueId
//
// This tool takes a password you *think* you typed and brute-forces
// plausible typo variants of it (fat-finger substitutions, dropped/doubled
// keys, transpositions, caps-lock, shift mistakes, ...) until one of them
// successfully authenticates against the file's GCM tag. Because GCM
// verifies a MAC, a successful decrypt is a correct password with
// overwhelming probability -- there are no false positives to sift through.
//
// v2 candidates are far more expensive to try than v1 (600,000 PBKDF2
// iterations per guess vs. a single SHA-256), so this tool prints a timing
// estimate before starting the sweep on a .lfl file.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function printHelp() {
  console.log(`recover-password.mjs - brute-force typo recovery for local-file-locker .enc/.lfl files

Usage:
  node tools/recover-password.mjs <input.enc|input.lfl> <password-guess> [options]

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
// Decryption (must match lib/crypto.ts and lib/vault.ts)
// ---------------------------------------------------------------------------

const V1_MIN_LEN = 12 + 16;

const V2_MAGIC = Buffer.from([0x4c, 0x46, 0x4c, 0x32]); // "LFL2"
const V2_HEADER_LEN = 4 + 16 + 4 + 12; // magic + salt + iterations + nonce

const CONTAINER_MAGIC = Buffer.from([0x4c, 0x46, 0x4c, 0x46]); // "LFLF"
const OPAQUE_ID_LEN = 36;
const CONTAINER_HEADER_LEN = 4 + 1 + OPAQUE_ID_LEN + 1 + 4; // 46
const CONTENT_FORMAT_RAW = 0x02;

const AAD_MAGIC = Buffer.from([0x4c, 0x46, 0x41, 0x44]); // "LFAD"
const AAD_VERSION = 1;
const AAD_ROLE_NAME = 0x01;
const AAD_ROLE_CONTENT = 0x02;

function buildAad(opaqueId, role) {
  return Buffer.concat([
    AAD_MAGIC,
    Buffer.from([AAD_VERSION, role === "name" ? AAD_ROLE_NAME : AAD_ROLE_CONTENT]),
    Buffer.from(opaqueId, "utf8"),
  ]);
}

function isV2Blob(buf) {
  return buf.length >= 4 && buf.subarray(0, 4).equals(V2_MAGIC);
}

// Reads the salt/iterations straight out of a v2 blob's own (unencrypted)
// header -- no password needed. Used only to give an honest time estimate.
function peekV2Params(buf) {
  if (!isV2Blob(buf)) return null;
  return { salt: buf.subarray(4, 20), iterations: buf.readUInt32BE(20) };
}

function tryDecryptV2Blob(password, blobBuffer, aad) {
  if (!isV2Blob(blobBuffer) || blobBuffer.length < V2_HEADER_LEN + 16) return null;
  const salt = blobBuffer.subarray(4, 20);
  const iterations = blobBuffer.readUInt32BE(20);
  const nonce = blobBuffer.subarray(24, 36);
  const rest = blobBuffer.subarray(36);
  const tag = rest.subarray(rest.length - 16);
  const ciphertext = rest.subarray(0, rest.length - 16);
  const key = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256");
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return null;
  }
}

function isLflContainer(buf) {
  return buf.length >= 4 && buf.subarray(0, 4).equals(CONTAINER_MAGIC);
}

function parseContainerHeader(buf) {
  if (buf.length < CONTAINER_HEADER_LEN || !isLflContainer(buf)) return null;
  let offset = 4 + 1; // magic + version
  const opaqueId = buf.subarray(offset, offset + OPAQUE_ID_LEN).toString("utf8");
  offset += OPAQUE_ID_LEN;
  const formatByte = buf[offset];
  offset += 1;
  const contentFormat = formatByte === CONTENT_FORMAT_RAW ? "raw-passthrough" : "v2-framed";
  const nameBlobLen = buf.readUInt32BE(offset);
  return { opaqueId, contentFormat, nameBlobLen };
}

function detectFormat(fileBuffer) {
  return isLflContainer(fileBuffer) ? "lfl" : "v1";
}

// Returns { content: Buffer, name?: string } on success, null on failure
// (wrong password, or -- for raw-passthrough .lfl content -- "can't be
// decrypted in-app at all", which the caller reports distinctly).
function tryDecrypt(password, fileBuffer, format) {
  if (format === "v1") {
    const key = crypto.createHash("sha256").update(password, "utf8").digest();
    const nonce = fileBuffer.subarray(0, 12);
    const rest = fileBuffer.subarray(12);
    if (rest.length < 16) return null;
    const tag = rest.subarray(rest.length - 16);
    const ciphertext = rest.subarray(0, rest.length - 16);
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAuthTag(tag);
      return { content: Buffer.concat([decipher.update(ciphertext), decipher.final()]) };
    } catch {
      return null;
    }
  }

  const header = parseContainerHeader(fileBuffer);
  if (!header) return null;
  const nameBlob = fileBuffer.subarray(CONTAINER_HEADER_LEN, CONTAINER_HEADER_LEN + header.nameBlobLen);
  const namePlain = tryDecryptV2Blob(password, nameBlob, buildAad(header.opaqueId, "name"));
  if (namePlain === null) return null;
  const name = namePlain.toString("utf8");

  if (header.contentFormat !== "v2-framed") {
    // Password confirmed via the name blob; content was imported as-is and
    // was never encrypted under this password to begin with (same as the
    // app's own behavior for raw-passthrough .enc imports).
    const raw = fileBuffer.subarray(CONTAINER_HEADER_LEN + header.nameBlobLen);
    return { content: raw, name, raw: true };
  }

  const contentBlob = fileBuffer.subarray(CONTAINER_HEADER_LEN + header.nameBlobLen);
  const contentPlain = tryDecryptV2Blob(password, contentBlob, buildAad(header.opaqueId, "content"));
  if (contentPlain === null) return null;
  return { content: contentPlain, name };
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

  const format = detectFormat(fileBuffer);
  console.error(`detected format: ${format === "lfl" ? "v2 (.lfl container)" : "v1 (legacy .enc)"}`);

  if (format === "v1" && fileBuffer.length < V1_MIN_LEN) {
    console.error(`input file is too short to be a valid v1 .enc file (need at least ${V1_MIN_LEN} bytes)`);
    process.exit(1);
  }
  if (format === "lfl" && !parseContainerHeader(fileBuffer)) {
    console.error("input file has the .lfl magic but is truncated or corrupt");
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

  if (format === "lfl") {
    const header = parseContainerHeader(fileBuffer);
    const nameBlob = fileBuffer.subarray(
      CONTAINER_HEADER_LEN,
      CONTAINER_HEADER_LEN + header.nameBlobLen
    );
    const params = peekV2Params(nameBlob);
    if (params) {
      const t0 = Date.now();
      crypto.pbkdf2Sync("timing-probe", params.salt, params.iterations, 32, "sha256");
      const perCandidateMs = Math.max(1, Date.now() - t0);
      const estimateSec = ((perCandidateMs * ordered.length) / 1000).toFixed(1);
      console.error(
        `v2 files use ${params.iterations} PBKDF2 iterations (~${perCandidateMs}ms/candidate on this machine).`
      );
      console.error(
        `estimated time for ${ordered.length} candidates: ~${estimateSec}s. If that's too slow, rerun with a smaller --max/--depth.`
      );
    }
  }

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
    const result = tryDecrypt(candidate, fileBuffer, format);
    if (result !== null) {
      const outputPath =
        args.output ??
        result.name ??
        (inputPath.endsWith(".enc") || inputPath.endsWith(".lfl")
          ? inputPath.slice(0, -4)
          : `${inputPath}.dec`);
      fs.writeFileSync(outputPath, result.content);
      console.log(`SUCCESS after ${tried} attempt(s).`);
      console.log(`recovered password: ${JSON.stringify(candidate)}`);
      if (result.name) console.log(`recovered filename: ${JSON.stringify(result.name)}`);
      if (result.raw) {
        console.log(
          "note: content was imported as raw-passthrough and was never encrypted under this password; the bytes written out are exactly what was originally imported."
        );
      }
      console.log(`plaintext written to: ${path.resolve(outputPath)}`);
      process.exit(0);
    }
  }

  console.error(`no candidate matched after ${tried} attempt(s).`);
  console.error("try increasing --depth/--max, or supply more seeds via --wordlist.");
  process.exit(2);
}

main();
