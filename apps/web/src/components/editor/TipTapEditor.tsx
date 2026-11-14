import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { Extension, Node, findParentNode, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import TextAlign from '@tiptap/extension-text-align';
import Typography from '@tiptap/extension-typography';
import Highlight from '@tiptap/extension-highlight';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { DOMOutputSpec, Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import {
  Bold,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  LayoutGrid,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Table2,
} from 'lucide-react';
import { htmlToMarkdown, markdownToEditorHtml } from '../../lib/markdown';
import { translate, useT } from '../../lib/i18n';
import { attachmentThumbnailUrl, cn } from '../../lib/utils';
import { isInlineImageMime } from '../../lib/media';
import { toast } from '../../stores/toast';

const lowlight = createLowlight(common);

const WikiLinkDecoration = Extension.create<{ onOpen?: (title: string) => void }>({
  name: 'wikiLinkDecoration',
  addOptions() {
    return { onOpen: undefined };
  },
  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin({
        key: new PluginKey('wiki-link-decoration'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return;
              const regex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;
              let match: RegExpExecArray | null;
              while ((match = regex.exec(node.text))) {
                const raw = match[0];
                const start = pos + match.index;
                // Keep the Markdown source intact, but hide the brackets and
                // the optional alias prefix so the editor shows only the
                // human-readable note title.
                const pipe = raw.slice(2, -2).indexOf('|');
                const labelStart = pipe === -1 ? 2 : 2 + pipe + 1;
                const labelEnd = raw.length - 2;
                if (labelStart > 0) {
                  decorations.push(Decoration.inline(start, start + labelStart, { class: 'nh-wiki-syntax' }));
                }
                decorations.push(
                  Decoration.inline(start + labelStart, start + labelEnd, {
                    class: 'nh-wikilink',
                    'data-note-title': match[1].trim(),
                    title: translate('点击打开笔记'),
                    nodeName: 'span',
                  }),
                );
                if (labelEnd < raw.length) {
                  decorations.push(Decoration.inline(start + labelEnd, start + raw.length, { class: 'nh-wiki-syntax' }));
                }
              }
            });
            return DecorationSet.create(state.doc, decorations);
          },
          handleClick(_view, _pos, event) {
            const target = event.target as HTMLElement;
            const link = target.closest('.nh-wikilink') as HTMLElement | null;
            if (link) {
              event.preventDefault();
              const title = link.getAttribute('data-note-title');
              if (title) options.onOpen?.(title);
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});

const SlashTrigger = Extension.create<{ onTrigger: (coords: { left: number; top: number; bottom: number }) => void }>({
  name: 'slashTrigger',
  addOptions() {
    return { onTrigger: () => {} };
  },
  addKeyboardShortcuts() {
    return {
      '/': () => {
        const { state, view } = this.editor;
        if (!state.selection.empty) return false;
        if (this.editor.isActive('codeBlock')) return false;
        const { $from } = state.selection;
        if ($from.parent.type.name !== 'paragraph' || $from.parent.textContent.trim().length > 0) return false;
        const coords = view.coordsAtPos(state.selection.from);
        this.options.onTrigger({ left: coords.left, top: coords.top, bottom: coords.bottom });
        return true;
      },
    };
  },
});

export interface SlashItem {
  title: string;
  description: string;
  icon: React.ReactNode;
  run: () => void;
}

function imageCaptionFromNode(node: ProseMirrorNode): string {
  const alt = String(node.attrs.alt ?? '').trim();
  const title = String(node.attrs.title ?? '').trim();
  return title && title !== alt ? title : !title && alt ? alt : '';
}

const OptimizedImage = Image.extend({
  addNodeView() {
    return ({ node }) => {
      let caption = imageCaptionFromNode(node);
      const figure = caption ? document.createElement('figure') : null;
      const img = document.createElement('img');
      const setImage = (current: ProseMirrorNode) => {
        const original = String(current.attrs.originalSrc || current.attrs.src || '');
        img.src = attachmentThumbnailUrl(original);
        img.alt = String(current.attrs.alt ?? '');
        img.title = String(current.attrs.title ?? '');
        img.loading = 'lazy';
        img.decoding = 'async';
        img.draggable = true;
        img.setAttribute('data-original-src', original);
      };
      setImage(node);
      let dom: HTMLElement = img;
      if (figure) {
        figure.className = 'prose-figure editor-figure';
        figure.contentEditable = 'false';
        const figcaption = document.createElement('figcaption');
        figcaption.textContent = caption;
        figure.append(img, figcaption);
        dom = figure;
      }
      return {
        dom,
        update(updated) {
          const nextCaption = imageCaptionFromNode(updated);
          if (Boolean(nextCaption) !== Boolean(caption)) return false;
          caption = nextCaption;
          setImage(updated);
          if (figure) {
            const figcaption = figure.querySelector('figcaption');
            if (figcaption) figcaption.textContent = nextCaption;
          }
          return true;
        },
        ignoreMutation: () => true,
      };
    };
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      originalSrc: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-original-src') || element.getAttribute('src'),
        renderHTML: (attributes) => (attributes.originalSrc ? { 'data-original-src': attributes.originalSrc } : {}),
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    const original = String(HTMLAttributes['data-original-src'] || HTMLAttributes.src || '');
    const alt = String(HTMLAttributes.alt ?? '').trim();
    const title = String(HTMLAttributes.title ?? '').trim();
    const caption = title && title !== alt ? title : !title && alt ? alt : '';
    const img: DOMOutputSpec = [
      'img',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        src: attachmentThumbnailUrl(original),
        'data-original-src': original,
        loading: 'lazy',
        decoding: 'async',
      }),
    ];
    if (!caption) return img;
    return [
      'figure',
      { class: 'prose-figure editor-figure' },
      img,
      ['figcaption', caption],
    ] satisfies DOMOutputSpec;
  },
});

export type ImageGridColumns = 2 | 3 | 4;

const ImageGrid = Node.create({
  name: 'imageGrid',
  group: 'block',
  content: 'image+',
  defining: true,

  addAttributes() {
    return {
      columns: {
        default: 2,
        parseHTML: (element) => {
          const value = Number(element.getAttribute('data-columns'));
          return value === 3 || value === 4 ? value : 2;
        },
        renderHTML: (attributes) => ({ 'data-columns': String(attributes.columns) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-image-grid]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-image-grid': 'true', class: 'image-grid' }), 0] satisfies DOMOutputSpec;
  },
});

const UploadPlaceholder = Node.create<{
  retry: (id: string) => void;
  remove: (id: string) => void;
}>({
  name: 'uploadPlaceholder',
  group: 'block',
  atom: true,
  selectable: false,
  draggable: false,

  addOptions() {
    return { retry: () => {}, remove: () => {} };
  },

  addAttributes() {
    return {
      uploadId: { default: null },
      filename: { default: '' },
      progress: { default: 0 },
      error: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-upload-placeholder]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const failed = Boolean(node.attrs.error);
    const progress = Math.max(0, Math.min(100, Number(node.attrs.progress) || 0));
    const pending = !failed && progress === 0;
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-upload-placeholder': 'true',
        class: failed ? 'editor-upload is-error' : 'editor-upload',
      }),
      ['div', { class: 'editor-upload-head' },
        ['span', { class: 'editor-upload-name' }, node.attrs.filename || translate('图片')],
        ['span', { class: 'editor-upload-pct' }, failed ? translate('失败') : pending ? translate('准备中') : `${progress}%`],
      ],
      ['div', { class: 'editor-upload-track' },
        ['div', { class: pending ? 'editor-upload-fill is-indeterminate' : 'editor-upload-fill', style: pending ? undefined : `width:${failed ? 100 : progress}%` }],
      ],
      failed
        ? ['div', { class: 'editor-upload-error' }, String(node.attrs.error)]
        : ['div', { class: 'editor-upload-hint' }, translate('正在上传，请稍候')],
      failed
        ? ['div', { class: 'editor-upload-actions' },
            ['button', { type: 'button', class: 'btn btn-secondary btn-sm', 'data-upload-retry': String(node.attrs.uploadId) }, translate('重试')],
            ['button', { type: 'button', class: 'btn btn-ghost btn-sm', 'data-upload-remove': String(node.attrs.uploadId) }, translate('移除')],
          ]
        : ['div', { class: 'editor-upload-hint' }, translate('上传完成后会自动插入')],
    ];
  },
});

export interface EditorHandle {
  editor: Editor;
  insertFiles: (files: File[]) => void;
  setImageGrid: (columns: ImageGridColumns) => void;
  ungroupImages: () => void;
}

export interface UploadedAttachment {
  id: string;
  filename: string;
  mime: string;
  url: string;
  hasThumbnail?: boolean;
  thumbnailUrl?: string | null;
}

export function TipTapEditor({
  noteId,
  initialMarkdown,
  reloadKey,
  editable,
  spellcheck,
  onChange,
  onReady,
  onWikiOpen,
  uploadFile,
}: {
  noteId: string;
  initialMarkdown: string;
  reloadKey: number;
  editable: boolean;
  spellcheck: boolean;
  onChange: (markdown: string) => void;
  onReady: (handle: EditorHandle | null) => void;
  onWikiOpen: () => void;
  uploadFile: (file: File, onProgress?: (percent: number) => void) => Promise<UploadedAttachment>;
}) {
  const t = useT();
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
  const wikiRef = useRef(onWikiOpen);
  const uploadRef = useRef(uploadFile);
  const editorRef = useRef<Editor | null>(null);
  const insertFilesRef = useRef<(files: File[]) => void>(() => {});
  const setImageGridRef = useRef<(columns: ImageGridColumns) => void>(() => {});
  const ungroupImagesRef = useRef<() => void>(() => {});
  const retryUploadRef = useRef<(id: string) => void>(() => {});
  const removeUploadRef = useRef<(id: string) => void>(() => {});
  const uploadFilesRef = useRef(new Map<string, File>());
  const uploadBatchesRef = useRef(new Map<string, { urls: Set<string>; completed: number; expected: number; columns: ImageGridColumns }>());
  const uploadBatchByUploadIdRef = useRef(new Map<string, string>());
  const [slash, setSlash] = useState<{ left: number; top: number; bottom: number } | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  onChangeRef.current = onChange;
  onReadyRef.current = onReady;
  wikiRef.current = onWikiOpen;
  uploadRef.current = uploadFile;

  const editor = useEditor({
    editable,
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        heading: { levels: [1, 2, 3, 4] },
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
        },
      }),
      Placeholder.configure({
        placeholder: t('开始写…输入 / 插入内容，或从工具栏上传图片'),
        includeChildren: true,
      }),
      OptimizedImage.configure({ allowBase64: false, inline: false }),
      ImageGrid,
      UploadPlaceholder.configure({
        retry: (id) => retryUploadRef.current(id),
        remove: (id) => removeUploadRef.current(id),
      }),
      TableKit.configure({ table: { resizable: true } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Typography,
      Highlight,
      CodeBlockLowlight.configure({ lowlight }),
      WikiLinkDecoration.configure({
        onOpen: (title) => {
          window.dispatchEvent(new CustomEvent('nh:open-wiki', { detail: { title } }));
        },
      }),
      SlashTrigger.configure({
        onTrigger: (coords) => {
          setSlash(coords);
          setSlashIndex(0);
        },
      }),
    ],
    content: markdownToEditorHtml(initialMarkdown),
    editorProps: {
      attributes: {
        class: 'prose',
        spellcheck: spellcheck ? 'true' : 'false',
      },
      handlePaste(_view, event) {
        const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.size > 0);
        if (!files.length) return false;
        event.preventDefault();
        insertFilesRef.current(files);
        return true;
      },
      handleDrop(_view, event) {
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []).filter((file) => file.size > 0);
        if (!files.length) return false;
        event.preventDefault();
        const current = editorRef.current;
        const position = current?.view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY });
        if (position && current) current.commands.setTextSelection(position.pos);
        insertFilesRef.current(files);
        return true;
      },
      handleClick(_view, _pos, event) {
        const image = (event.target as HTMLElement | null)?.closest('img');
        const src = image?.getAttribute('data-original-src') || image?.getAttribute('src');
        if (!src) return false;
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('nh:open-image', { detail: { src, alt: image?.getAttribute('alt') || '', title: image?.getAttribute('title') || '', editable: true } }));
        return true;
      },
      handleDOMEvents: {
        click(_view, event) {
          const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-upload-retry],[data-upload-remove]');
          if (!target) return false;
          event.preventDefault();
          const retry = target.getAttribute('data-upload-retry');
          const remove = target.getAttribute('data-upload-remove');
          if (retry) retryUploadRef.current(retry);
          if (remove) removeUploadRef.current(remove);
          return true;
        },
      },
    },
    onUpdate: ({ editor }) => {
      onChangeRef.current(htmlToMarkdown(editor.getHTML()));
    },
  });

  function findUpload(id: string): { node: ProseMirrorNode; pos: number } | null {
    const current = editorRef.current;
    if (!current) return null;
    let found: { node: ProseMirrorNode; pos: number } | null = null;
    current.state.doc.descendants((node, pos) => {
      if (node.type.name === 'uploadPlaceholder' && node.attrs.uploadId === id) {
        found = { node, pos };
        return false;
      }
      return true;
    });
    return found;
  }

  function updateUpload(id: string, attrs: Record<string, unknown>): void {
    const current = editorRef.current;
    const found = findUpload(id);
    if (!current || !found) return;
    current.view.dispatch(
      current.state.tr.setNodeMarkup(found.pos, undefined, { ...found.node.attrs, ...attrs }),
    );
  }

  function collectAdjacentImages(current: Editor): { images: ProseMirrorNode[]; from: number; to: number } | null {
    const { state } = current;
    const { $from } = state.selection;
    const parent = $from.parent;
    const index = $from.index();
    let first = -1;
    for (let i = Math.max(0, index - 1); i <= Math.min(parent.childCount - 1, index + 1); i++) {
      if (parent.child(i).type.name === 'image') {
        first = i;
        break;
      }
    }
    if (first < 0) return null;
    let start = first;
    let end = first;
    while (start > 0 && parent.child(start - 1).type.name === 'image') start--;
    while (end < parent.childCount - 1 && parent.child(end + 1).type.name === 'image') end++;
    if (end - start < 1) return null;
    let from = $from.start();
    for (let i = 0; i < start; i++) from += parent.child(i).nodeSize;
    let to = from;
    const images: ProseMirrorNode[] = [];
    for (let i = start; i <= end; i++) {
      const child = parent.child(i);
      images.push(child);
      to += child.nodeSize;
    }
    return { images, from, to };
  }

  function findGridAtSelection(current: Editor): { node: ProseMirrorNode; pos: number } | null {
    const { state } = current;
    const existing = findParentNode((node) => node.type.name === 'imageGrid')(state.selection);
    if (existing) return { node: existing.node, pos: existing.pos };
    const { $from } = state.selection;
    const parent = $from.parent;
    const index = $from.index();
    for (let i = Math.max(0, index - 1); i <= Math.min(parent.childCount - 1, index + 1); i++) {
      const child = parent.child(i);
      if (child.type.name !== 'imageGrid') continue;
      let pos = $from.start();
      for (let j = 0; j < i; j++) pos += parent.child(j).nodeSize;
      return { node: child, pos };
    }
    return null;
  }

  function clampGridColumns(columns: ImageGridColumns, count: number): ImageGridColumns {
    return Math.min(columns, Math.max(2, count)) as ImageGridColumns;
  }

  function setImageGrid(columns: ImageGridColumns): void {
    const current = editorRef.current;
    if (!current) return;
    const { state, view } = current;
    const existing = findGridAtSelection(current);
    if (existing) {
      const effective = clampGridColumns(columns, existing.node.childCount);
      view.dispatch(state.tr.setNodeMarkup(existing.pos, undefined, { ...existing.node.attrs, columns: effective }).scrollIntoView());
      return;
    }
    const adjacent = collectAdjacentImages(current);
    if (!adjacent) {
      toast('info', t('请把光标放在相邻的两张或更多图片上'));
      return;
    }
    const gridNode = state.schema.nodes.imageGrid.create({ columns: clampGridColumns(columns, adjacent.images.length) }, adjacent.images);
    const transaction = state.tr.replaceWith(adjacent.from, adjacent.to, gridNode);
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(adjacent.from + 1)));
    view.dispatch(transaction.scrollIntoView());
  }

  function ungroupImages(): void {
    const current = editorRef.current;
    if (!current) return;
    const { state, view } = current;
    const existing = findGridAtSelection(current);
    if (!existing) {
      toast('info', t('请把光标放在图片组内'));
      return;
    }
    const images: ProseMirrorNode[] = [];
    existing.node.forEach((child) => images.push(child));
    const transaction = state.tr.replaceWith(existing.pos, existing.pos + existing.node.nodeSize, images);
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(existing.pos + 1)));
    view.dispatch(transaction.scrollIntoView());
  }

  function groupUploadedBatch(batchId: string): void {
    const batch = uploadBatchesRef.current.get(batchId);
    const current = editorRef.current;
    if (!batch || !current) return;
    const { state, view } = current;
    const found: Array<{ node: ProseMirrorNode; pos: number }> = [];
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'image' && batch.urls.has(String(node.attrs.src ?? ''))) found.push({ node, pos });
    });
    if (found.length < 2) {
      uploadBatchesRef.current.delete(batchId);
      return;
    }
    const parent = state.doc.resolve(found[0].pos).parent;
    for (let i = 1; i < found.length; i++) {
      if (!state.doc.resolve(found[i].pos).parent.eq(parent)) {
        uploadBatchesRef.current.delete(batchId);
        return;
      }
      if (found[i - 1].pos + found[i - 1].node.nodeSize !== found[i].pos) {
        uploadBatchesRef.current.delete(batchId);
        return;
      }
    }
    const gridNode = state.schema.nodes.imageGrid.create({ columns: batch.columns }, found.map((entry) => entry.node));
    const first = found[0];
    const last = found[found.length - 1];
    const transaction = state.tr.replaceWith(first.pos, last.pos + last.node.nodeSize, gridNode);
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(first.pos + 1)));
    view.dispatch(transaction.scrollIntoView());
    uploadBatchesRef.current.delete(batchId);
  }

  function removeUpload(id: string): void {
    const current = editorRef.current;
    const found = findUpload(id);
    uploadFilesRef.current.delete(id);
    const batchId = uploadBatchByUploadIdRef.current.get(id);
    if (batchId) {
      uploadBatchByUploadIdRef.current.delete(id);
      uploadBatchesRef.current.delete(batchId);
    }
    if (!current || !found) return;
    current.chain().focus().deleteRange({ from: found.pos, to: found.pos + found.node.nodeSize }).run();
  }

  function replaceUpload(id: string, result: UploadedAttachment): void {
    const current = editorRef.current;
    const found = findUpload(id);
    uploadFilesRef.current.delete(id);
    if (!current || !found) return;
    const inlineImage = isInlineImageMime(result.mime);
    const previewImage = result.mime.startsWith('image/') && result.hasThumbnail && result.thumbnailUrl;
    const src = inlineImage || previewImage ? (inlineImage ? result.url : result.thumbnailUrl) : null;
    const content = src
      ? { type: 'image', attrs: { src, alt: '', title: '' } }
      : { type: 'text', text: result.filename, marks: [{ type: 'link', attrs: { href: result.url } }] };
    current.chain().focus()
      .insertContentAt({ from: found.pos, to: found.pos + found.node.nodeSize }, content, { updateSelection: true })
      .run();
    const batchId = uploadBatchByUploadIdRef.current.get(id);
    uploadBatchByUploadIdRef.current.delete(id);
    if (batchId) {
      const batch = uploadBatchesRef.current.get(batchId);
      if (batch) {
        if (src) batch.urls.add(src);
        batch.completed += 1;
        if (batch.completed >= batch.expected) {
          window.setTimeout(() => groupUploadedBatch(batchId), 0);
        }
      }
    }
  }

  async function runUpload(id: string, file: File): Promise<void> {
    try {
      const result = await uploadRef.current(file, (percent) => {
        updateUpload(id, { progress: Math.max(0, Math.min(99, Math.round(percent))) });
      });
      updateUpload(id, { progress: 100 });
      replaceUpload(id, result);
    } catch (error) {
      updateUpload(id, {
        progress: 100,
        error: (error as Error).message || translate('上传失败'),
      });
    }
  }

  function insertUpload(file: File, id = crypto.randomUUID()): void {
    const current = editorRef.current;
    if (!current) return;
    uploadFilesRef.current.set(id, file);
    // A block placeholder cannot live inside an image grid. Put it after the
    // grid instead of splitting the existing group.
    const insideGrid = findParentNode((node) => node.type.name === 'imageGrid')(current.state.selection);
    const chain = current.chain().focus();
    if (insideGrid) chain.setTextSelection(insideGrid.pos + insideGrid.node.nodeSize);
    chain.insertContent({
      type: 'uploadPlaceholder',
      attrs: { uploadId: id, filename: file.name, progress: 0, error: null },
    }).run();
    void runUpload(id, file);
  }

  function insertFiles(files: File[]): void {
    if (!files.length) return;
    if (files.length > 1) {
      const batchId = crypto.randomUUID();
      uploadBatchesRef.current.set(batchId, { urls: new Set(), completed: 0, expected: files.length, columns: 2 });
      for (const file of files) {
        const id = crypto.randomUUID();
        uploadBatchByUploadIdRef.current.set(id, batchId);
        insertUpload(file, id);
      }
      return;
    }
    insertUpload(files[0]);
  }

  function retryUpload(id: string): void {
    const file = uploadFilesRef.current.get(id);
    if (!file) return;
    updateUpload(id, { progress: 0, error: null });
    void runUpload(id, file);
  }

  insertFilesRef.current = insertFiles;
  setImageGridRef.current = setImageGrid;
  ungroupImagesRef.current = ungroupImages;
  retryUploadRef.current = retryUpload;
  removeUploadRef.current = removeUpload;

  useEffect(() => {
    editorRef.current = editor ?? null;
    onReadyRef.current(editor ? {
      editor,
      insertFiles: (files) => insertFilesRef.current(files),
      setImageGrid: (columns) => setImageGridRef.current(columns),
      ungroupImages: () => ungroupImagesRef.current(),
    } : null);
    return () => {
      editorRef.current = null;
      onReadyRef.current(null);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable);
  }, [editor, editable]);

  useEffect(() => {
    if (!editor || reloadKey === 0) return;
    const markdown = useAppStoreContent(noteId);
    editor.commands.setContent(markdownToEditorHtml(markdown), { emitUpdate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  useEffect(() => {
    if (!editor) return;
    editor.setOptions({
      editorProps: {
        attributes: {
          class: 'prose',
          spellcheck: spellcheck ? 'true' : 'false',
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': t('正文'),
        },
      },
    });
  }, [editor, spellcheck]);

  useEffect(() => {
    if (!slash) return;
    const close = () => setSlash(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSlashIndex((index) => (index + 1) % slashItems.length);
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSlashIndex((index) => (index - 1 + slashItems.length) % slashItems.length);
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        slashItems[slashIndex]?.run();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', close);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', close);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slash, slashIndex, editor]);

  const slashItems: SlashItem[] = editor
    ? [
        {
          title: t('标题 1'),
          description: t('大标题'),
          icon: <Heading1 size={15} />,
          run: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
        },
        {
          title: t('标题 2'),
          description: t('章节标题'),
          icon: <Heading2 size={15} />,
          run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        },
        {
          title: t('标题 3'),
          description: t('小节标题'),
          icon: <Heading3 size={15} />,
          run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
        },
        {
          title: t('无序列表'),
          description: t('用圆点列出要点'),
          icon: <List size={15} />,
          run: () => editor.chain().focus().toggleBulletList().run(),
        },
        {
          title: t('有序列表'),
          description: t('用数字排列步骤'),
          icon: <ListOrdered size={15} />,
          run: () => editor.chain().focus().toggleOrderedList().run(),
        },
        {
          title: t('任务列表'),
          description: t('可以勾选的待办'),
          icon: <ListChecks size={15} />,
          run: () => editor.chain().focus().toggleTaskList().run(),
        },
        {
          title: t('引用'),
          description: t('引用一段话'),
          icon: <Quote size={15} />,
          run: () => editor.chain().focus().toggleBlockquote().run(),
        },
        {
          title: t('代码块'),
          description: t('带语法高亮的代码'),
          icon: <Code2 size={15} />,
          run: () => editor.chain().focus().toggleCodeBlock().run(),
        },
        {
          title: t('表格'),
          description: t('插入 3 × 3 表格'),
          icon: <Table2 size={15} />,
          run: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
        },
        {
          title: t('图片组'),
          description: t('把相邻图片排成 2 列'),
          icon: <LayoutGrid size={15} />,
          run: () => setImageGridRef.current(2),
        },
        {
          title: t('分割线'),
          description: t('分隔内容'),
          icon: <Minus size={15} />,
          run: () => editor.chain().focus().setHorizontalRule().run(),
        },
        {
          title: t('双向链接'),
          description: t('链接到另一篇笔记'),
          icon: <Link2 size={15} />,
          run: () => wikiRef.current(),
        },
      ]
    : [];

  return (
    <div style={{ position: 'relative' }}>
      <EditorContent editor={editor} />
      {slash && (
        <div
          className="slash-menu"
          style={{
            left: Math.min(slash.left, window.innerWidth - 276),
            top: slash.bottom + 230 > window.innerHeight ? Math.max(12, slash.top - 330) : slash.bottom + 8,
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="slash-menu-label">{t('插入')}</div>
          {slashItems.map((item, index) => (
            <button
              key={item.title}
              type="button"
              className={cn('slash-item', index === slashIndex && 'active')}
              onMouseEnter={() => setSlashIndex(index)}
              onClick={() => {
                item.run();
                setSlash(null);
              }}
            >
              <span className="slash-icon">{item.icon}</span>
              <span>
                <span className="slash-title">{item.title}</span>
                <span className="slash-desc">{item.description}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// The editor is remounted per note, but reloads (conflict merges) need the latest store content.
import { useAppStore } from '../../stores/app';
function useAppStoreContent(noteId: string): string {
  return useAppStore.getState().note?.id === noteId ? useAppStore.getState().note?.contentMd ?? '' : '';
}

void Bold;
void ImageIcon;
