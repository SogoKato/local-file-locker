export const getMimeType = (data: Uint8Array): string => {
  const signatures = {
    "image/png": [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
    "image/jpeg": [0xFF, 0xD8, 0xFF],
    "image/gif": [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
    "image/bmp": [0x42, 0x4D],
  }

  for (const [mime, signature] of Object.entries(signatures)) {
    if (hasSignature(data, signature)) return mime;
  }
  if (isTextData(data)) return "text/plain";
  return "application/octet-stream";
}

function hasSignature(data: Uint8Array, signature: number[]) {
  if (data.length < signature.length) return false;

  for (let i = 0; i < signature.length; i++) {
      if (data[i] !== signature[i]) return false;
  }
  return true;
}

function isTextData(data: Uint8Array) {
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0x00) {
        return false;
    }
}
return true;
}
