import { afterAll, describe, expect, it } from 'vitest';
import { setLocale, translate } from './i18n';

describe('English singularization', () => {
  afterAll(() => setLocale('zh-CN'));

  it('does not leak an undefined qualifier into relative time', () => {
    setLocale('en');
    expect(translate('{n} 天前', { n: 1 })).toBe('1 day ago');
    expect(translate('{n} 天前', { n: 3 })).toBe('3 days ago');
    expect(translate('{n} 分钟前', { n: 1 })).toBe('1 min ago');
  });
});
