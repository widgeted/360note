export type ThemePreference = 'system' | 'light' | 'dark';

const THEME_KEY = 'nh-theme';
const MOTION_KEY = 'nh-reduce-motion';

function systemTheme(): 'light' | 'dark' {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  return preference === 'system' ? systemTheme() : preference;
}

export function applyTheme(preference: ThemePreference, reduceMotion?: boolean): void {
  const resolved = resolveTheme(preference);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#141310' : '#f8f6f1');
  if (reduceMotion !== undefined) {
    document.documentElement.dataset.reduceMotion = reduceMotion ? 'true' : 'false';
    localStorage.setItem(MOTION_KEY, reduceMotion ? 'true' : 'false');
  }
}

function cachedAccountTheme(): ThemePreference | null {
  try {
    const raw = localStorage.getItem('nh-auth-cache');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { user?: { prefs?: { theme?: string } } };
    const theme = parsed?.user?.prefs?.theme;
    return theme === 'light' || theme === 'dark' || theme === 'system' ? theme : null;
  } catch {
    return null;
  }
}

export function initializeTheme(): void {
  const saved = cachedAccountTheme() ?? (localStorage.getItem(THEME_KEY) as ThemePreference | null) ?? 'system';
  applyTheme(saved, localStorage.getItem(MOTION_KEY) === 'true');
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if ((localStorage.getItem(THEME_KEY) as ThemePreference | null) === 'system') applyTheme('system');
  });
}

function syncCachedAccountPrefs(preference: ThemePreference, reduceMotion?: boolean): void {
  try {
    const raw = localStorage.getItem('nh-auth-cache');
    if (!raw) return;
    const parsed = JSON.parse(raw) as { user?: { prefs?: Record<string, unknown> } };
    if (!parsed?.user) return;
    parsed.user.prefs = {
      ...(parsed.user.prefs ?? {}),
      theme: preference,
      ...(reduceMotion === undefined ? {} : { reduceMotion }),
    };
    localStorage.setItem('nh-auth-cache', JSON.stringify(parsed));
  } catch {
    /* ignore quota/private mode */
  }
}

export function storeTheme(preference: ThemePreference, reduceMotion?: boolean): void {
  localStorage.setItem(THEME_KEY, preference);
  syncCachedAccountPrefs(preference, reduceMotion);
  applyTheme(preference, reduceMotion);
}

export function getStoredTheme(): ThemePreference {
  return (localStorage.getItem(THEME_KEY) as ThemePreference | null) ?? 'system';
}
