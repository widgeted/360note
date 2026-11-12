import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { getLocale, useLocale } from './i18n';

function brand(): string {
  return getLocale() === 'zh-CN' ? '360笔记' : '360note';
}

function defaultTitle(): string {
  return getLocale() === 'zh-CN'
    ? '360笔记 — 把想法留下，把知识连起来'
    : '360note — Keep ideas, connect knowledge';
}

function defaultDescription(): string {
  return getLocale() === 'zh-CN'
    ? '360笔记：一个安静、快速、本地优先的笔记空间。记录想法，建立联系，发布作品。'
    : '360note: a calm, fast, local-first notebook for ideas, knowledge and publishing.';
}

function siteOrigin(): string {
  const host = window.location.hostname.toLowerCase();
  if (host === '360note.com' || host === 'www.360note.com') return 'https://360note.com';
  if (host === '360biji.com' || host === 'www.360biji.com') return 'https://360biji.com';
  return window.location.origin;
}

const PUBLIC_PATHS = new Set(['/', '/about', '/privacy', '/terms']);

function upsertMeta(attribute: 'name' | 'property', key: string, content: string): void {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
}

function resetSeoLinks(): void {
  document.head.querySelectorAll('link[data-nh-seo]').forEach((element) => element.remove());
}

function addLink(rel: string, href: string, hreflang?: string): void {
  const element = document.createElement('link');
  element.rel = rel;
  element.href = href;
  element.dataset.nhSeo = 'true';
  if (hreflang) element.hreflang = hreflang;
  document.head.appendChild(element);
}

function upsertStructuredData(canonical: string, description: string): void {
  document.head.querySelectorAll('script[data-nh-seo-jsonld]').forEach((element) => element.remove());
  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.dataset.nhSeoJsonld = 'true';
  script.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: brand(),
    alternateName: getLocale() === 'zh-CN' ? '360note' : '360笔记',
    url: canonical,
    description,
    inLanguage: getLocale() === 'zh-CN' ? 'zh-CN' : 'en',
  });
  document.head.appendChild(script);
}

/**
 * Keeps the tab title and public-page SEO metadata in sync with the current
 * surface. Private surfaces are noindex automatically; public landing/about/
 * legal pages get canonical + bilingual hreflang + OG/Twitter metadata.
 */
export function useDocumentTitle(
  title?: string | null,
  options?: { description?: string; noindex?: boolean },
): void {
  const location = useLocation();
  const locale = useLocale();
  const description = options?.description;
  const explicitNoindex = options?.noindex;

  useEffect(() => {
    const path = location.pathname === '/' ? '/' : location.pathname.replace(/\/+$/, '');
    const pageTitle = title ? `${title} — ${brand()}` : defaultTitle();
    const pageDescription = description ?? defaultDescription();
    const isPublic = PUBLIC_PATHS.has(path);
    const noindex = explicitNoindex ?? !isPublic;
    document.title = pageTitle;

    upsertMeta('name', 'description', pageDescription);
    upsertMeta('name', 'robots', noindex ? 'noindex, nofollow' : 'index, follow');
    upsertMeta('property', 'og:title', pageTitle);
    upsertMeta('property', 'og:description', pageDescription);
    upsertMeta('property', 'og:type', 'website');
    upsertMeta('property', 'og:site_name', brand());
    upsertMeta('name', 'twitter:title', pageTitle);
    upsertMeta('name', 'twitter:description', pageDescription);

    resetSeoLinks();
    if (noindex) {
      document.head.querySelectorAll('link[rel="canonical"], link[rel="alternate"][hreflang]').forEach((element) => {
        if (!element.hasAttribute('data-nh-seo')) element.remove();
      });
      return;
    }

    const origin = siteOrigin();
    const canonical = `${origin}${path}`;
    addLink('canonical', canonical);
    addLink('alternate', `https://360note.com${path}`, 'en');
    addLink('alternate', `https://360biji.com${path}`, 'zh-CN');
    addLink('alternate', `https://360note.com${path}`, 'x-default');
    upsertMeta('property', 'og:url', canonical);
    upsertMeta('property', 'og:locale', getLocale() === 'zh-CN' ? 'zh_CN' : 'en_US');
    upsertMeta('property', 'og:locale:alternate', getLocale() === 'zh-CN' ? 'en_US' : 'zh_CN');
    upsertMeta('name', 'twitter:card', 'summary_large_image');
    if (path === '/') upsertStructuredData(canonical, pageDescription);
    else document.head.querySelectorAll('script[data-nh-seo-jsonld]').forEach((element) => element.remove());
  }, [title, description, explicitNoindex, location.pathname, locale]);
}
