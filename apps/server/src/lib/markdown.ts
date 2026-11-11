import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { escapeHtml } from './text.js';

const ALLOWED_TAGS = [
  'a','p','br','hr','em','strong','del','s','u','code','pre','blockquote',
  'h1','h2','h3','h4','h5','h6','ul','ol','li','table','thead','tbody','tfoot','tr','th','td',
  'img','figure','figcaption','input','span','div','sup','sub','mark',
];

const ALLOWED_ATTRS: sanitizeHtml.IOptions['allowedAttributes'] = {
  a: ['href', 'title', 'target', 'rel', 'class', 'download', 'data-note-title'],
  img: ['src', 'alt', 'title', 'width', 'height', 'class'],
  figure: ['class'],
  input: ['type', 'checked', 'disabled'],
  th: ['align', 'colspan', 'rowspan'],
  td: ['align', 'colspan', 'rowspan'],
  code: ['class'],
  pre: ['class'],
  span: ['class'],
  div: ['class', 'data-columns', 'data-image-grid'],
  '*': ['id'],
};

function imageCaption(attrs: string): string {
  const alt = /\balt="([^"]*)"/i.exec(attrs)?.[1]?.trim() ?? '';
  const title = /\btitle="([^"]*)"/i.exec(attrs)?.[1]?.trim() ?? '';
  return title && title !== alt ? title : !title && alt ? alt : '';
}

export function renderMarkdownHtml(markdown: string): string {
  let html = marked.parse(markdown, { gfm: true, breaks: false, async: false }) as string;
  html = html.replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_match, title: string, alias?: string) => {
    return `<a class="nh-wikilink" data-note-title="${escapeHtml(title.trim())}">${escapeHtml((alias || title).trim())}</a>`;
  });
  html = html.replace(/<p>\s*(<img\b([^>]*)>)\s*<\/p>/gi, (match, img: string, attrs: string) => {
    const caption = imageCaption(attrs);
    return caption ? `<figure class="prose-figure">${img}<figcaption>${caption}</figcaption></figure>` : match;
  });
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRS,
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    transformTags: {
      a: (tagName, attribs) => {
        if (attribs.href && !attribs.href.startsWith('#')) {
          return { tagName, attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' } };
        }
        return { tagName, attribs };
      },
    },
  });
}

export function exportHtmlDocument(input: {
  title: string;
  contentHtml: string;
  meta?: string;
  footer?: string;
  accent?: string;
}): string {
  const accent = input.accent || '#17865b';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)} — 360note</title>
<style>
  :root { --ink:#14161b; --muted:#6b6a66; --paper:#fbfaf7; --line:#e6e2da; --accent:${accent}; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--paper); color:var(--ink);
    font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    line-height: 1.72; -webkit-font-smoothing: antialiased; }
  .wrap { max-width: 820px; margin: 0 auto; padding: 64px 28px 96px; }
  .brand { display:flex; justify-content:space-between; align-items:center; color:var(--muted); font-size:13px; letter-spacing:.02em; margin-bottom:48px; }
  .brand strong { color:var(--ink); font-weight:650; }
  .meta { color:var(--muted); font-size:13px; margin: 0 0 36px; }
  h1 { font-weight:650; letter-spacing:-.04em; font-size: 40px; line-height:1.14; margin: 0 0 18px; }
  h2 { font-size: 26px; letter-spacing:-.022em; margin: 2.1em 0 .6em; font-weight:650; }
  h3 { font-size: 20px; letter-spacing:-.012em; margin: 1.7em 0 .5em; font-weight:650; }
  p, li { font-size: 16.5px; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { color: var(--accent); text-decoration: none; }
  .nh-wikilink { color: var(--accent); border-bottom: 1px solid color-mix(in srgb, var(--accent) 35%, transparent); }
  blockquote { margin: 1.5em 0; padding: 2px 0 2px 22px; border-left: 2px solid var(--accent); color:#45443f; }
  code { background:#efede7; border-radius:5px; padding:.12em .38em; font: .88em "SFMono-Regular", Consolas, monospace; }
  pre { background:#171a21; color:#e9e7e1; border-radius:12px; padding:20px 22px; overflow:auto; line-height:1.55; }
  pre code { background:none; padding:0; font-size:13.5px; color:inherit; }
  table { width:100%; border-collapse: collapse; margin:1.6em 0; font-size:14.5px; }
  th, td { border-bottom:1px solid var(--line); text-align:left; padding:10px 12px; vertical-align:top; }
  th { color:var(--muted); font-weight:600; font-size:13px; text-transform: uppercase; letter-spacing:.05em; }
  img { max-width:100%; height:auto; border-radius:8px; margin: 1em 0; }
  .prose-figure { margin: 1.5em 0; }
  .prose-figure img { margin: 0; }
  .prose-figure figcaption { margin-top: 7px; color: var(--muted); font-size: 13px; line-height: 1.5; }
  .image-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; margin:1.4em 0; align-items:start; }
  .image-grid[data-columns="3"] { grid-template-columns:repeat(3,minmax(0,1fr)); }
  .image-grid[data-columns="4"] { grid-template-columns:repeat(4,minmax(0,1fr)); }
  .image-grid > img, .image-grid > figure, .image-grid > p { margin:0; min-width:0; }
  .image-grid img { width:100%; height:auto; max-height:none; border-radius:7px; margin:0; }
  .image-grid .prose-figure { width:100%; margin:0; }
  .image-grid figcaption { margin-top:5px; font-size:12px; text-align:center; }
  hr { border:0; border-top:1px solid var(--line); margin: 3em 0; }
  input[type=checkbox] { margin-right:.5em; accent-color: var(--accent); }
  .attachments { margin-top: 56px; padding-top: 22px; border-top:1px solid var(--line); }
  .attachments h2 { font-size:14px; margin:0 0 12px; color:var(--muted); text-transform:uppercase; letter-spacing:.08em; }
  .attachments ul { padding-left: 18px; font-size:14px; color:var(--muted); }
  footer { margin-top: 64px; padding-top: 18px; border-top:1px solid var(--line); color:var(--muted); font-size:13px; display:flex; justify-content:space-between; }
  @media (max-width: 640px) { .wrap { padding: 40px 20px 64px; } h1 { font-size: 34px; } }
  @media print {
    @page { size: A4; margin: 16mm 15mm; }
    body { background:#fff; font-size: 10.5pt; line-height: 1.65; }
    .wrap { max-width: 180mm; padding: 0; }
    .brand { margin-bottom: 14pt; font-size: 9pt; }
    h1 { font-size: 22pt; line-height: 1.2; margin-bottom: 8pt; }
    h2 { font-size: 14pt; margin: 1.6em 0 .5em; }
    h3 { font-size: 11.5pt; margin: 1.4em 0 .45em; }
    h4 { font-size: 10.5pt; }
    p, li { font-size: 10.5pt; }
    .meta { font-size: 9.5pt; margin-bottom: 18pt; }
    table { font-size: 9.5pt; }
    th { font-size: 8.5pt; }
    pre { font-size: 9pt; padding: 10pt 12pt; break-inside: avoid; }
    pre code { font-size: 9pt; }
    .attachments { margin-top: 28pt; padding-top: 12pt; }
    .attachments h2, .attachments ul { font-size: 9.5pt; }
    .prose-figure figcaption { font-size: 9pt; color: #666; }
    img { max-height: 150mm; }
    .image-grid { gap:2mm; margin:3mm 0; break-inside:auto; }
    .image-grid > img, .image-grid > figure, .image-grid > p { break-inside:avoid; page-break-inside:avoid; }
    .image-grid img { width:100%; max-height:none; }
    footer { margin-top: 28pt; padding-top: 10pt; font-size: 9pt; }
    a { color: inherit; }
    .nh-wikilink { border:0; }
  }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand"><strong>360note</strong><span>360note.com</span></div>
  <h1>${escapeHtml(input.title)}</h1>
  ${input.meta ? `<div class="meta">${escapeHtml(input.meta)}</div>` : ''}
  <article>${input.contentHtml}</article>
  ${input.footer || ''}
  <footer><span>Exported from 360note</span><span>${new Date().toISOString().slice(0, 10)}</span></footer>
</div>
</body>
</html>`;
}
