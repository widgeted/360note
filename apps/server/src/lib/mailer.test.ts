import { describe, expect, it } from 'vitest';
import { isReservedMailAddress } from './mailer.js';

describe('mail delivery safety', () => {
  it('blocks reserved test domains', () => {
    for (const address of [
      'sec-register-1@invalid.local',
      'user@example.com',
      'user@example.org',
      'user@foo.invalid',
      'user@foo.test',
      'user@localhost',
    ]) {
      expect(isReservedMailAddress(address)).toBe(true);
    }
  });

  it('allows real account addresses', () => {
    expect(isReservedMailAddress('access@126.com')).toBe(false);
    expect(isReservedMailAddress('owner@360note.com')).toBe(false);
  });
});
