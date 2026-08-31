// Vault orchestration: opaque naming, AAD, file-container framing, name
// resolution/caching, and directory path resolution. Composes lib/crypto.ts
// (encryption primitive) with lib/opfsStore.ts (raw OPFS I/O) - neither of
// those modules knows about passwords+names together, this one does.

import { encrypt, decrypt } from "@/lib/crypto";
import * as opfsStore from "@/lib/opfsStore";

// --- AAD -------------------------------------------------------------------
//
// AAD must always be rebuilt from the entry's *ambient* opaque id (the
// caller-supplied id of the OPFS object being read/written right now) and
// never from anything embedded inside the blob's own plaintext/ciphertext.
// Trusting an embedded id would let an attacker relocate a whole valid blob
// to a different opaque id and have it authenticate against itself - AAD
// only catches that kind of substitution if it's derived from something the
// attacker doesn't control.

export type AadRole = "name" | "content";

// Every directory holds its own encrypted real name in a sentinel file
// literally called "name" (see the directory layout comment below) - this
// can never collide with a real child's opaque id, since those are always
// crypto.randomUUID() strings and never equal this literal.
const DIR_NAME_FILE = "name";

const AAD_MAGIC = new Uint8Array([0x4c, 0x46, 0x41, 0x44]); // "LFAD"
const AAD_VERSION = 1;
const AAD_ROLE_NAME = 0x01;
const AAD_ROLE_CONTENT = 0x02;

export const buildAad = (id: string, role: AadRole): Uint8Array<ArrayBuffer> => {
  const idBytes = new TextEncoder().encode(id);
  const out = new Uint8Array(AAD_MAGIC.length + 2 + idBytes.length);
  let offset = 0;
  out.set(AAD_MAGIC, offset);
  offset += AAD_MAGIC.length;
  out[offset] = AAD_VERSION;
  offset += 1;
  out[offset] = role === "name" ? AAD_ROLE_NAME : AAD_ROLE_CONTENT;
  offset += 1;
  out.set(idBytes, offset);
  return out;
};

// --- File container framing -------------------------------------------------
//
// offset  size  field
// 0       4     magic "LFLF"
// 4       1     version (u8 = 1)
// 5       36    opaqueId (UUID string) - advisory write-time hint only, never
//                trusted for AAD reconstruction on read
// 41      1     contentFormat: 0x01 = v2-framed, 0x02 = raw-passthrough
// 42      4     nameBlobLen (u32 BE)
// 46      *     nameBlob (v2 crypto.ts blob, plaintext = real file name)
// 46+len  *     contentBlob (v2 blob) or raw passthrough bytes

export type ContentFormat = "v2-framed" | "raw-passthrough";

const CONTAINER_MAGIC = new Uint8Array([0x4c, 0x46, 0x4c, 0x46]); // "LFLF"
const CONTAINER_VERSION = 1;
const CONTENT_FORMAT_V2 = 0x01;
const CONTENT_FORMAT_RAW = 0x02;
const OPAQUE_ID_LENGTH = 36; // crypto.randomUUID() length
const HEADER_LENGTH = CONTAINER_MAGIC.length + 1 + OPAQUE_ID_LENGTH + 1 + 4; // 46
const V2_BLOB_OVERHEAD = 4 + 16 + 4 + 12 + 16; // v2 header(36) + GCM tag(16)

type DecodedHeader = {
  opaqueId: string;
  contentFormat: ContentFormat;
  nameBlobLen: number;
};

const encodeContainer = (
  opaqueId: string,
  contentFormat: ContentFormat,
  nameBlob: Uint8Array,
  contentBytes: Uint8Array
): Uint8Array => {
  const idBytes = new TextEncoder().encode(opaqueId);
  if (idBytes.length !== OPAQUE_ID_LENGTH) {
    throw new Error("opaqueId must be a 36-byte UUID string");
  }
  const nameBlobLenBytes = new Uint8Array(4);
  new DataView(nameBlobLenBytes.buffer).setUint32(0, nameBlob.length, false);

  const out = new Uint8Array(HEADER_LENGTH + nameBlob.length + contentBytes.length);
  let offset = 0;
  out.set(CONTAINER_MAGIC, offset);
  offset += CONTAINER_MAGIC.length;
  out[offset] = CONTAINER_VERSION;
  offset += 1;
  out.set(idBytes, offset);
  offset += OPAQUE_ID_LENGTH;
  out[offset] = contentFormat === "v2-framed" ? CONTENT_FORMAT_V2 : CONTENT_FORMAT_RAW;
  offset += 1;
  out.set(nameBlobLenBytes, offset);
  offset += 4;
  out.set(nameBlob, offset);
  offset += nameBlob.length;
  out.set(contentBytes, offset);
  return out;
};

const decodeHeader = (headerBytes: Uint8Array): DecodedHeader => {
  if (
    headerBytes.length < HEADER_LENGTH ||
    !CONTAINER_MAGIC.every((b, i) => headerBytes[i] === b)
  ) {
    throw new Error("Not a valid vault file container");
  }
  let offset = CONTAINER_MAGIC.length + 1; // skip magic + version
  const idBytes = headerBytes.slice(offset, offset + OPAQUE_ID_LENGTH);
  offset += OPAQUE_ID_LENGTH;
  const opaqueId = new TextDecoder().decode(idBytes);
  const formatByte = headerBytes[offset];
  offset += 1;
  const contentFormat: ContentFormat =
    formatByte === CONTENT_FORMAT_RAW ? "raw-passthrough" : "v2-framed";
  const nameBlobLenBytes = headerBytes.slice(offset, offset + 4);
  const nameBlobLen = new DataView(nameBlobLenBytes.buffer).getUint32(0, false);
  return { opaqueId, contentFormat, nameBlobLen };
};

const readContainerHeaderAndName = async (
  file: File
): Promise<{ header: DecodedHeader; nameBlobBytes: Uint8Array }> => {
  const headerBytes = new Uint8Array(await file.slice(0, HEADER_LENGTH).arrayBuffer());
  const header = decodeHeader(headerBytes);
  const nameBlobBytes = new Uint8Array(
    await file.slice(HEADER_LENGTH, HEADER_LENGTH + header.nameBlobLen).arrayBuffer()
  );
  return { header, nameBlobBytes };
};

const readContainerContent = async (file: File, header: DecodedHeader): Promise<Uint8Array> => {
  const contentStart = HEADER_LENGTH + header.nameBlobLen;
  return new Uint8Array(await file.slice(contentStart).arrayBuffer());
};

// --- Name resolution cache ---------------------------------------------------
//
// Keyed by (opaqueId, password). Both hits and misses are cached forever: a
// given opaqueId's ciphertext never mutates in place (updates always write a
// new id), so "password P does not unlock entry X" is permanently valid, not
// just a memoization of a slow-but-repeatable check.

type NameResolution = { ok: true; name: string } | { ok: false };
const nameCache = new Map<string, Map<string, NameResolution>>();

const cacheNameResult = (opaqueId: string, password: string, result: NameResolution) => {
  let inner = nameCache.get(opaqueId);
  if (!inner) {
    inner = new Map();
    nameCache.set(opaqueId, inner);
  }
  inner.set(password, result);
};

const primeNameCache = (opaqueId: string, password: string, name: string) => {
  cacheNameResult(opaqueId, password, { ok: true, name });
};

const clearNameCache = (opaqueId: string) => {
  nameCache.delete(opaqueId);
};

const resolveName = async (
  opaqueId: string,
  nameBlobBytes: Uint8Array,
  password: string
): Promise<NameResolution> => {
  const cached = nameCache.get(opaqueId)?.get(password);
  if (cached) return cached;
  let result: NameResolution;
  try {
    const plaintext = await decrypt(password, nameBlobBytes, buildAad(opaqueId, "name"));
    result = { ok: true, name: new TextDecoder().decode(plaintext) };
  } catch {
    result = { ok: false };
  }
  cacheNameResult(opaqueId, password, result);
  return result;
};

// --- Entry types --------------------------------------------------------

export type VaultFileEntry = {
  kind: "file";
  opaqueId: string;
  opaquePath: string[];
  name: string | null; // null = locked: current password doesn't decrypt the name
  size: number;
  contentFormat: ContentFormat;
  plainData: Uint8Array | null;
};

export type VaultDirEntry = {
  kind: "directory";
  opaqueId: string;
  opaquePath: string[];
  name: string | null;
  children?: VaultEntry[]; // undefined = not expanded
};

export type VaultEntry = VaultFileEntry | VaultDirEntry;

const sortEntries = (entries: VaultEntry[]): VaultEntry[] =>
  entries.sort((a, b) => {
    if (a.name !== null && b.name !== null) return a.name.localeCompare(b.name);
    if (a.name !== null) return -1;
    if (b.name !== null) return 1;
    return a.opaqueId.localeCompare(b.opaqueId);
  });

// --- Listing / refreshing -------------------------------------------------

export const listEntries = async (
  opaquePath: string[],
  password: string
): Promise<VaultEntry[]> => {
  const children = await opfsStore.listChildren(opaquePath);
  const entries: VaultEntry[] = [];

  for (const child of children) {
    if (child.kind === "file" && child.id === DIR_NAME_FILE) continue; // this dir's own sentinel, not a child
    const childPath = [...opaquePath, child.id];

    if (child.kind === "directory") {
      let name: string | null = null;
      try {
        const nameFile = await opfsStore.readFile([...childPath, DIR_NAME_FILE]);
        const nameBlobBytes = new Uint8Array(await nameFile.arrayBuffer());
        const res = await resolveName(child.id, nameBlobBytes, password);
        if (res.ok) name = res.name;
      } catch {
        // missing/malformed name file - degrade to locked, same as a wrong password
      }
      entries.push({ kind: "directory", opaqueId: child.id, opaquePath: childPath, name });
      continue;
    }

    try {
      const file = await opfsStore.readFile(childPath);
      const { header, nameBlobBytes } = await readContainerHeaderAndName(file);
      const res = await resolveName(child.id, nameBlobBytes, password);
      const contentLength = file.size - HEADER_LENGTH - header.nameBlobLen;
      const size =
        header.contentFormat === "v2-framed"
          ? Math.max(0, contentLength - V2_BLOB_OVERHEAD)
          : contentLength;
      entries.push({
        kind: "file",
        opaqueId: child.id,
        opaquePath: childPath,
        name: res.ok ? res.name : null,
        size,
        contentFormat: header.contentFormat,
        plainData: null,
      });
    } catch (e) {
      console.error("listEntries: failed to read file entry", childPath.join("/"), e);
      entries.push({
        kind: "file",
        opaqueId: child.id,
        opaquePath: childPath,
        name: null,
        size: 0,
        contentFormat: "raw-passthrough",
        plainData: null,
      });
    }
  }

  return sortEntries(entries);
};

export const refreshEntries = async (
  opaquePath: string[],
  password: string,
  oldEntries: VaultEntry[]
): Promise<VaultEntry[]> => {
  const freshEntries = await listEntries(opaquePath, password);
  return Promise.all(
    freshEntries.map(async (entry) => {
      if (entry.kind !== "directory") return entry;
      const oldEntry = oldEntries.find(
        (e) => e.kind === "directory" && e.opaqueId === entry.opaqueId
      ) as VaultDirEntry | undefined;
      if (oldEntry?.children !== undefined) {
        entry.children = await refreshEntries(entry.opaquePath, password, oldEntry.children);
      }
      return entry;
    })
  );
};

// --- Opening / writing / deleting -----------------------------------------

export const openFileContent = async (
  entry: VaultFileEntry,
  password: string
): Promise<Uint8Array> => {
  if (entry.contentFormat !== "v2-framed") {
    throw new Error("This file was imported as-is and cannot be decrypted in-app.");
  }
  const file = await opfsStore.readFile(entry.opaquePath);
  const { header } = await readContainerHeaderAndName(file);
  const contentBytes = await readContainerContent(file, header);
  return decrypt(password, contentBytes, buildAad(entry.opaqueId, "content"));
};

export const writeNewFile = async (
  parentOpaquePath: string[],
  realName: string,
  plaintext: Uint8Array,
  password: string
): Promise<VaultFileEntry> => {
  const opaqueId = crypto.randomUUID();
  const nameBlob = await encrypt(
    password,
    new TextEncoder().encode(realName),
    buildAad(opaqueId, "name")
  );
  const contentBlob = await encrypt(password, plaintext, buildAad(opaqueId, "content"));
  const container = encodeContainer(opaqueId, "v2-framed", nameBlob, contentBlob);
  const opaquePath = [...parentOpaquePath, opaqueId];
  await opfsStore.writeFile(opaquePath, container);
  primeNameCache(opaqueId, password, realName);
  return {
    kind: "file",
    opaqueId,
    opaquePath,
    name: realName,
    size: plaintext.length,
    contentFormat: "v2-framed",
    plainData: plaintext,
  };
};

export const writeRawImportedFile = async (
  parentOpaquePath: string[],
  realName: string,
  rawBytes: Uint8Array,
  password: string
): Promise<VaultFileEntry> => {
  const opaqueId = crypto.randomUUID();
  const nameBlob = await encrypt(
    password,
    new TextEncoder().encode(realName),
    buildAad(opaqueId, "name")
  );
  const container = encodeContainer(opaqueId, "raw-passthrough", nameBlob, rawBytes);
  const opaquePath = [...parentOpaquePath, opaqueId];
  await opfsStore.writeFile(opaquePath, container);
  primeNameCache(opaqueId, password, realName);
  return {
    kind: "file",
    opaqueId,
    opaquePath,
    name: realName,
    size: rawBytes.length,
    contentFormat: "raw-passthrough",
    plainData: null,
  };
};

// Re-import of a file this app previously exported (see exportEntry). No
// password needed: bytes are copied verbatim. The embedded opaqueId is
// reused as the new on-disk name so the AAD binding inside the copied blobs
// stays consistent by construction (see the AAD note above for why we can't
// just mint a fresh id here).
export const importExportedFile = async (
  parentOpaquePath: string[],
  exportedBytes: Uint8Array
): Promise<VaultFileEntry> => {
  const header = decodeHeader(exportedBytes.slice(0, HEADER_LENGTH));
  const opaquePath = [...parentOpaquePath, header.opaqueId];

  const existing = await opfsStore.listChildren(parentOpaquePath);
  if (existing.some((e) => e.id === header.opaqueId)) {
    throw new Error(
      "An entry with this file's id already exists at the destination; import aborted."
    );
  }

  await opfsStore.writeFile(opaquePath, exportedBytes);
  const contentLength = exportedBytes.length - HEADER_LENGTH - header.nameBlobLen;
  const size =
    header.contentFormat === "v2-framed"
      ? Math.max(0, contentLength - V2_BLOB_OVERHEAD)
      : contentLength;
  return {
    kind: "file",
    opaqueId: header.opaqueId,
    opaquePath,
    name: null, // unknown without a password; a subsequent listEntries() resolves it
    size,
    contentFormat: header.contentFormat,
    plainData: null,
  };
};

export const exportEntry = async (
  entry: VaultFileEntry
): Promise<{ bytes: Uint8Array; filename: string }> => {
  const file = await opfsStore.readFile(entry.opaquePath);
  const allBytes = new Uint8Array(await file.arrayBuffer());
  if (entry.contentFormat === "v2-framed") {
    return { bytes: allBytes, filename: `${entry.name ?? entry.opaqueId}.lfl` };
  }
  const header = decodeHeader(allBytes.slice(0, HEADER_LENGTH));
  const contentStart = HEADER_LENGTH + header.nameBlobLen;
  return {
    bytes: allBytes.subarray(contentStart),
    filename: `${entry.name ?? entry.opaqueId}.enc`,
  };
};

// Recursively gathers every file under opaquePath as raw, still-encrypted
// bytes (same as exportEntry, just for a whole subtree at once) - no
// password-gated decryption happens here, so locked entries are included
// too, just under an opaqueId-based name instead of their real one. Used
// for "download this folder as a zip".
export type DownloadItem = { relativePath: string; bytes: Uint8Array };

// Disambiguates a filename against siblings already placed in the same zip
// directory (e.g. two files that both decrypt to "invoice.pdf") by inserting
// "(1)", "(2)", ... before the extension, so neither silently overwrites the
// other when the archive is extracted.
const dedupeFilename = (filename: string, index: number): string => {
  if (index === 0) return filename;
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex > 0
    ? `${filename.slice(0, dotIndex)} (${index})${filename.slice(dotIndex)}`
    : `${filename} (${index})`;
};

export const collectFolderForDownload = async (
  opaquePath: string[],
  password: string
): Promise<DownloadItem[]> => {
  const entries = await listEntries(opaquePath, password);
  const items: DownloadItem[] = [];
  const nameCounts = new Map<string, number>();

  for (const entry of entries) {
    if (entry.kind === "file") {
      const { bytes, filename } = await exportEntry(entry);
      const index = nameCounts.get(filename) ?? 0;
      nameCounts.set(filename, index + 1);
      items.push({ relativePath: dedupeFilename(filename, index), bytes });
    } else {
      const dirName = entry.name ?? entry.opaqueId;
      const children = await collectFolderForDownload(entry.opaquePath, password);
      for (const child of children) {
        items.push({ relativePath: `${dirName}/${child.relativePath}`, bytes: child.bytes });
      }
    }
  }

  return items;
};

export const deleteEntry = async (entry: VaultEntry): Promise<void> => {
  await opfsStore.removeEntry(entry.opaquePath, { recursive: entry.kind === "directory" });
  clearNameCache(entry.opaqueId);
};

// --- Directory path resolution ---------------------------------------------
//
// Walks a typed logical path (e.g. "invoices/2026") from the vault root,
// matching each segment against existing sibling directories whose `name`
// blob decrypts (under the current password) to that segment; creates a new
// opaque directory when no match is found. Shares resolveName's cache, so
// directories already browsed/expanded resolve for free.

export const resolveOrCreateDirPath = async (
  logicalSegments: string[],
  password: string
): Promise<string[]> => {
  let opaquePath: string[] = [];

  for (const rawSegment of logicalSegments) {
    const segment = rawSegment.trim();
    if (segment === "") continue;

    const children = await opfsStore.listChildren(opaquePath);
    let matchId: string | null = null;

    for (const child of children) {
      if (child.kind !== "directory") continue;
      try {
        const nameFile = await opfsStore.readFile([...opaquePath, child.id, DIR_NAME_FILE]);
        const nameBlobBytes = new Uint8Array(await nameFile.arrayBuffer());
        const res = await resolveName(child.id, nameBlobBytes, password);
        if (res.ok && res.name === segment) {
          matchId = child.id;
          break;
        }
      } catch {
        // missing/malformed name file - skip
      }
    }

    if (matchId === null) {
      matchId = crypto.randomUUID();
      const nameBlob = await encrypt(
        password,
        new TextEncoder().encode(segment),
        buildAad(matchId, "name")
      );
      await opfsStore.ensureDir([...opaquePath, matchId]);
      await opfsStore.writeFile([...opaquePath, matchId, DIR_NAME_FILE], nameBlob);
      primeNameCache(matchId, password, segment);
    }

    opaquePath = [...opaquePath, matchId];
  }

  return opaquePath;
};
