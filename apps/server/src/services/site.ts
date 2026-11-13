import { getSetting, setSetting } from './settings.js';

export const DEFAULT_SITE_HEAD_CODE =
  '<meta name="baidu-site-verification" content="codeva-zUIgMMzGVb" />';

export const MAX_SITE_HEAD_CODE = 20000;

export interface SiteCodeSettings {
  code: string;
  defaultCode: string;
  maxLength: number;
}

export async function getSiteHeadCode(): Promise<string> {
  const stored = await getSetting<{ headCode?: string }>('site');
  return stored?.headCode ?? DEFAULT_SITE_HEAD_CODE;
}

export async function getSiteCodeSettings(): Promise<SiteCodeSettings> {
  return {
    code: await getSiteHeadCode(),
    defaultCode: DEFAULT_SITE_HEAD_CODE,
    maxLength: MAX_SITE_HEAD_CODE,
  };
}

export async function saveSiteHeadCode(code: string): Promise<void> {
  await setSetting('site', { headCode: code });
}
