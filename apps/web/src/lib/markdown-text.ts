/** Editor bodies do not need trailing blank lines; imports and Markdown-mode
 * saves can carry them and they become a visible extra empty line when another
 * tab receives the note through cross-tab sync. */
export function trimTrailingBlankLines(markdown: string): string {
  return markdown.replace(/\r\n/g, '\n').replace(/\n+$/, '');
}
