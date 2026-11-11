import { describe, expect, it } from 'vitest';
import { trimTrailingBlankLines } from './markdown-text';

describe('trimTrailingBlankLines', () => {
  it('removes trailing blank lines without touching the body', () => {
    expect(trimTrailingBlankLines('# Title\n\nBody\n\n\n')).toBe('# Title\n\nBody');
    expect(trimTrailingBlankLines('Body\r\n')).toBe('Body');
    expect(trimTrailingBlankLines('Body')).toBe('Body');
  });
});
