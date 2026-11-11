/** MIME types every supported browser can render directly in an <img>. */
export function isInlineImageMime(mime: string): boolean {
  return /^image\/(png|jpeg|gif|webp|avif)$/i.test(mime);
}
