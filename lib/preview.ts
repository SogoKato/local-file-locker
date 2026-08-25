export type PreviewKind =
  | "image"
  | "svg"
  | "text"
  | "audio"
  | "video"
  | "pdf"
  | "unsupported";

export const getPreviewKind = (mimeType: string): PreviewKind => {
  if (mimeType === "image/svg+xml") return "svg";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("text/")) return "text";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType === "application/pdf") return "pdf";
  return "unsupported";
};
