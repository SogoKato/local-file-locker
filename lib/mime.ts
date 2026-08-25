type Detector = (data: Uint8Array) => string | null;

function matchesAt(data: Uint8Array, offset: number, bytes: number[]): boolean {
  if (data.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (data[offset + i] !== bytes[i]) return false;
  }
  return true;
}

function matchesAnyAt(data: Uint8Array, offset: number, alternatives: number[][]): boolean {
  return alternatives.some((bytes) => matchesAt(data, offset, bytes));
}

function asciiAt(data: Uint8Array, offset: number, length: number): string {
  if (data.length < offset + length) return "";
  return String.fromCharCode(...data.slice(offset, offset + length));
}

const simpleSignature = (mime: string, bytes: number[]): Detector =>
  (data) => (matchesAt(data, 0, bytes) ? mime : null);

// RIFF container: "RIFF" + 4-byte size (variable) + 4-byte format tag.
const detectRiff: Detector = (data) => {
  if (!matchesAt(data, 0, [0x52, 0x49, 0x46, 0x46])) return null; // "RIFF"
  const format = asciiAt(data, 8, 4);
  if (format === "WEBP") return "image/webp";
  if (format === "WAVE") return "audio/wav";
  return null;
};

// ISO-BMFF container: 4-byte size (variable) + "ftyp" + 4-byte brand.
const detectIsoBmff: Detector = (data) => {
  if (!matchesAt(data, 4, [0x66, 0x74, 0x79, 0x70])) return null; // "ftyp"
  const brand = asciiAt(data, 8, 4);
  if (brand === "avif" || brand === "avis") return "image/avif";
  if (brand === "qt  ") return "video/quicktime";
  return "video/mp4"; // isom, iso2, mp41, mp42, M4A, etc.
};

const detectMp3: Detector = (data) => {
  if (matchesAt(data, 0, [0x49, 0x44, 0x33])) return "audio/mpeg"; // "ID3"
  if (matchesAnyAt(data, 0, [[0xFF, 0xFB], [0xFF, 0xF3], [0xFF, 0xF2], [0xFF, 0xFA]])) {
    return "audio/mpeg";
  }
  return null;
};

const detectors: Detector[] = [
  simpleSignature("image/png", [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  simpleSignature("image/jpeg", [0xFF, 0xD8, 0xFF]),
  simpleSignature("image/gif", [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
  simpleSignature("image/bmp", [0x42, 0x4D]),
  simpleSignature("image/x-icon", [0x00, 0x00, 0x01, 0x00]),
  simpleSignature("application/pdf", [0x25, 0x50, 0x44, 0x46]), // "%PDF"
  simpleSignature("audio/flac", [0x66, 0x4C, 0x61, 0x43]), // "fLaC"
  simpleSignature("audio/ogg", [0x4F, 0x67, 0x67, 0x53]), // "OggS"
  simpleSignature("video/webm", [0x1A, 0x45, 0xDF, 0xA3]), // EBML header
  detectRiff,
  detectIsoBmff,
  detectMp3,
];

export const getMimeType = (data: Uint8Array): string => {
  for (const detect of detectors) {
    const mime = detect(data);
    if (mime) return mime;
  }
  if (isTextData(data)) {
    return isSvgText(data) ? "image/svg+xml" : "text/plain";
  }
  return "application/octet-stream";
}

function isTextData(data: Uint8Array) {
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0x00) {
      return false;
    }
  }
  return true;
}

// Only <img> renders this (never inlined into the DOM), so embedded
// <script>/event handlers never execute: image contexts disable SVG scripting.
function isSvgText(data: Uint8Array): boolean {
  const prefix = new TextDecoder("utf-8", { fatal: false })
    .decode(data.slice(0, Math.min(data.length, 512)));
  return /<svg[\s>]/i.test(prefix);
}
