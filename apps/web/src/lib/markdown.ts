import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { attachmentThumbnailUrl } from './utils';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { escapeHtml } from './utils';

// Never allow data: URLs on links. They are legitimate only for images.
DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (data.attrName === 'href' && /^\s*data:/i.test(data.attrValue)) data.keepAttr = false;
});

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
  strongDelimiter: '**',
  linkStyle: 'inlined',
});
turndown.use(gfm);
turndown.addRule('underline', {
  filter: ['u'],
  replacement: (content) => `<u>${content}</u>`,
});
turndown.addRule('highlight', {
  filter: ['mark'],
  replacement: (content) => `<mark>${content}</mark>`,
});
// Keep wiki links as Markdown source instead of letting Turndown escape
// the brackets into `\[\[...\]\]`.
turndown.addRule('nhWikilink', {
  filter: (node) => ['A', 'SPAN'].includes(node.nodeName) && (node as HTMLElement).classList.contains('nh-wikilink'),
  replacement: (_content, node) => {
    const title = (node as HTMLElement).getAttribute('data-note-title')?.trim();
    if (!title) return _content;
    const label = (node as HTMLElement).textContent?.trim() ?? title;
    return label && label !== title ? `[[${title}|${label}]]` : `[[${title}]]`;
  },
});

// TipTap emits tables with colgroup/paragraph wrappers that the stock GFM
// rule does not always recognise. Convert every table explicitly and keep
// the markdown source canonical.
turndown.addRule('nhTable', {
  filter: 'table',
  replacement: (_content, node) => {
    const table = node as HTMLTableElement;
    const rows = Array.from(table.rows);
    if (!rows.length) return _content;
    const clean = (cell: HTMLTableCellElement) =>
      (cell.textContent ?? '').replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');
    const header = Array.from(rows[0].cells).map(clean);
    const body = rows.slice(1).map((row) => Array.from(row.cells).map(clean));
    const width = Math.max(header.length, ...body.map((row) => row.length));
    const pad = (cells: string[]) => [...cells, ...Array(Math.max(0, width - cells.length)).fill('')];
    return `\n\n| ${pad(header).join(' | ')} |\n| ${Array(width).fill('---').join(' | ')} |\n${body
      .map((row) => `| ${pad(row).join(' | ')} |`)
      .join('\n')}\n\n`;
  },
});

turndown.addRule('taskListItems', {
  filter: (node) =>
    node.nodeName === 'LI' &&
    (node as HTMLElement).parentElement?.getAttribute('data-type') === 'taskList',
  replacement: (content, node) => {
    const checked = (node as HTMLElement).getAttribute('data-checked') === 'true';
    return `- [${checked ? 'x' : ' '}] ${content.trim()}\n`;
  },
});

export function htmlToMarkdown(html: string): string {
  if (!html || html === '<p></p>') return '';
  const withoutPlaceholders = new DOMParser().parseFromString(html, 'text/html');
  withoutPlaceholders.querySelectorAll('[data-upload-placeholder]').forEach((element) => element.remove());
  // The editor renders captions in a figure for display, but Markdown stores
  // them as the image title. Drop the display-only figcaption before Turndown.
  withoutPlaceholders.querySelectorAll('figure').forEach((figure) => {
    figure.querySelectorAll('figcaption').forEach((caption) => caption.remove());
    const image = figure.querySelector('img');
    if (image) figure.replaceWith(image);
    else figure.remove();
  });
  withoutPlaceholders.querySelectorAll('img[data-original-src]').forEach((image) => {
    const original = image.getAttribute('data-original-src');
    if (original) image.setAttribute('src', original);
    image.removeAttribute('data-original-src');
  });
  return turndown
    .turndown(withoutPlaceholders.body.innerHTML)
    // Turndown escapes brackets in inline text. Wiki links are deliberate
    // syntax, not prose punctuation, so restore them after conversion.
    .replace(/\\\[\\\[([^\]]+?)\\\]\\\]/g, '[[$1]]')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'rel', 'data-type', 'data-checked', 'checked', 'disabled', 'data-note-title'],
    ADD_TAGS: ['mark', 'u', 'figure', 'figcaption'],
    ALLOW_DATA_ATTR: true,
  });
}

function enhanceTaskLists(html: string, keepInputs = false): string {
  if (!html.includes('type="checkbox"')) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('ul').forEach((ul) => {
    const items = [...ul.children].filter((child) => child.tagName === 'LI');
    if (!items.length) return;
    const allTasks = items.every((item) => item.querySelector('input[type="checkbox"]'));
    if (!allTasks) return;
    ul.setAttribute('data-type', 'taskList');
    items.forEach((item) => {
      const input = item.querySelector<HTMLInputElement>('input[type="checkbox"]');
      const checked = Boolean(input?.checked);
      if (!keepInputs) input?.remove();
      item.setAttribute('data-type', 'taskItem');
      item.setAttribute('data-checked', String(checked));
      if (!keepInputs && !item.querySelector('p')) {
        const p = doc.createElement('p');
        p.innerHTML = item.innerHTML.trim() || '<br>';
        item.innerHTML = '';
        item.appendChild(p);
      }
    });
  });
  return doc.body.innerHTML;
}

function wikiLinkify(root: ParentNode): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.parentElement?.closest('a, code, pre')) continue;
    if (node.textContent?.includes('[[')) nodes.push(node);
  }
  for (const node of nodes) {
    const text = node.textContent ?? '';
    const regex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;
    if (!regex.test(text)) continue;
    regex.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text))) {
      if (match.index > lastIndex) fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      const link = document.createElement('a');
      link.className = 'nh-wikilink';
      link.setAttribute('data-note-title', match[1].trim());
      link.textContent = (match[2] || match[1]).trim();
      fragment.appendChild(link);
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    node.replaceWith(fragment);
  }
}

function addHeadingIds(root: ParentNode): { id: string; text: string; level: number }[] {
  const toc: { id: string; text: string; level: number }[] = [];
  const used = new Map<string, number>();
  root.querySelectorAll('h1, h2, h3').forEach((heading, index) => {
    const text = heading.textContent?.trim() ?? '';
    if (!text) return;
    const base = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || `section-${index + 1}`;
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    const id = count ? `${base}-${count + 1}` : base;
    (heading as HTMLElement).id = id;
    toc.push({ id, text, level: Number(heading.tagName.slice(1)) });
  });
  return toc;
}

export interface RenderedMarkdown {
  html: string;
  toc: Array<{ id: string; text: string; level: number }>;
}

export function renderMarkdown(markdown: string, options: { toc?: boolean; wikiLinks?: boolean } = {}): RenderedMarkdown {
  const raw = marked.parse(markdown, { gfm: true, breaks: false, async: false }) as string;
  const clean = enhanceTaskLists(sanitize(raw), true);
  const doc = new DOMParser().parseFromString(`<div id="__root">${clean}</div>`, 'text/html');
  const root = doc.getElementById('__root')!;
  root.querySelectorAll('img[src]').forEach((image) => {
    const original = image.getAttribute('src') ?? '';
    const thumb = attachmentThumbnailUrl(original);
    if (thumb !== original) {
      image.setAttribute('data-original-src', original);
      image.setAttribute('src', thumb);
      image.setAttribute('loading', 'lazy');
      image.setAttribute('decoding', 'async');
    }
    const alt = (image.getAttribute('alt') ?? '').trim();
    const title = (image.getAttribute('title') ?? '').trim();
    const caption = title && title !== alt ? title : !title && alt ? alt : '';
    if (!caption) return;
    const figure = doc.createElement('figure');
    figure.className = 'prose-figure';
    const parent = image.parentElement;
    if (parent && parent.tagName === 'P' && parent.children.length === 1 && !(parent.textContent ?? '').trim()) {
      parent.replaceWith(figure);
    } else {
      image.replaceWith(figure);
    }
    figure.appendChild(image);
    const captionEl = doc.createElement('figcaption');
    captionEl.textContent = caption;
    figure.appendChild(captionEl);
  });
  if (options.wikiLinks !== false) wikiLinkify(root);
  root.querySelectorAll('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href') ?? '';
    if (/^https?:/i.test(href)) {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    }
  });
  const toc = options.toc ? addHeadingIds(root) : [];
  return { html: root.innerHTML, toc };
}

/** Title is stored separately, so drop a leading H1 that duplicates it. */
export function stripDuplicateTitle(markdown: string, title: string): string {
  const cleanTitle = title.trim();
  if (!cleanTitle) return markdown;
  const escaped = cleanTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^\\s*#\\s+${escaped}\\s*(?:\\r?\\n)+`, 'i');
  return markdown.replace(pattern, '').replace(/^\s*\n+/, '');
}

export function markdownToEditorHtml(markdown: string): string {
  const raw = marked.parse(markdown, { gfm: true, breaks: false, async: false }) as string;
  return enhanceTaskLists(sanitize(raw));
}

export function markdownExcerpt(markdown: string, max = 160): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~[\]()|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function plainTextOf(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent ?? '';
}

export { escapeHtml };
