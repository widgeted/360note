import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { Extension } from '@tiptap/core';
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
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import {
  Bold,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
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
import { cn } from '../../lib/utils';

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
  onReady: (editor: Editor | null) => void;
  onWikiOpen: () => void;
  uploadFile: (file: File) => Promise<{ url: string; mime: string; filename: string; id: string } | null>;
}) {
  const t = useT();
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
  const wikiRef = useRef(onWikiOpen);
  const uploadRef = useRef(uploadFile);
  const [slash, setSlash] = useState<{ left: number; top: number; bottom: number } | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [uploading, setUploading] = useState(false);
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
      Image.configure({ allowBase64: false, inline: false }),
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
        void handleFiles(files);
        return true;
      },
      handleDrop(_view, event) {
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []).filter((file) => file.size > 0);
        if (!files.length) return false;
        event.preventDefault();
        void handleFiles(files);
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      onChangeRef.current(htmlToMarkdown(editor.getHTML()));
    },
  });

  async function handleFiles(files: File[]) {
    if (!editor) return;
    setUploading(true);
    try {
      for (const file of files) {
        const result = await uploadRef.current(file);
        if (!result) continue;
        if (result.mime.startsWith('image/')) {
          editor.chain().focus().setImage({ src: result.url, alt: result.filename, title: result.filename }).run();
        } else {
          editor.chain().focus().insertContent(`[${result.filename}](${result.url})`).run();
        }
      }
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
    onReadyRef.current(editor ?? null);
    return () => onReadyRef.current(null);
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
      {uploading && (
        <div style={{ position: 'absolute', right: 8, top: 8, display: 'flex', alignItems: 'center', gap: 6, padding: '5px 9px', borderRadius: 6, background: 'var(--surface)', border: '1px solid var(--line)', fontSize: 13, color: 'var(--text-tertiary)' }}>
          <span className="spinner" style={{ width: 12, height: 12 }} /> {t('正在上传…')}
        </div>
      )}
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
