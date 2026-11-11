import { useRef } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import {
  Bold,
  Code,
  Code2,
  Columns2,
  Columns3,
  Columns4,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  LayoutGrid,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Plus,
  Quote,
  Redo2,
  RemoveFormatting,
  Rows3,
  Strikethrough,
  Table2,
  Trash2,
  Ungroup,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react';
import { useT } from '../../lib/i18n';
import { useIsMobile } from '../../lib/useMediaQuery';
import { useScrollFade } from '../../lib/useScrollFade';
import { cn, shortcutLabel } from '../../lib/utils';
import { Dropdown, MenuItem } from '../Dropdown';

export function EditorToolbar({
  editor,
  onLink,
  onWiki,
  onImages,
  onImageGrid,
  onUngroupImages,
}: {
  editor: Editor;
  onLink: () => void;
  onWiki: () => void;
  onImages: (files: File[]) => void;
  onImageGrid: (columns: 2 | 3 | 4) => void;
  onUngroupImages: () => void;
}) {
  const t = useT();
  const isMobile = useIsMobile();
  const scrollFade = useScrollFade<HTMLDivElement>();
  const fileRef = useRef<HTMLInputElement>(null);
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      underline: current.isActive('underline'),
      strike: current.isActive('strike'),
      code: current.isActive('code'),
      heading1: current.isActive('heading', { level: 1 }),
      heading2: current.isActive('heading', { level: 2 }),
      heading3: current.isActive('heading', { level: 3 }),
      bulletList: current.isActive('bulletList'),
      orderedList: current.isActive('orderedList'),
      taskList: current.isActive('taskList'),
      blockquote: current.isActive('blockquote'),
      codeBlock: current.isActive('codeBlock'),
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
      inTable: current.isActive('table'),
      imageGridColumns: current.isActive('imageGrid') ? Number(current.getAttributes('imageGrid').columns) : null,
    }),
  });

  const headingLabel = state?.heading1 ? 'H1' : state?.heading2 ? 'H2' : state?.heading3 ? 'H3' : isMobile ? '¶' : t('正文');

  return (
    <div className="editor-toolbar-wrap">
      <div ref={scrollFade.ref} className={cn('editor-toolbar', scrollFade.className)} role="toolbar" aria-label={t('格式工具栏')}>
        <div className="toolbar-group">
          <button type="button" className="tool-btn" onClick={() => editor.chain().focus().undo().run()} disabled={!state?.canUndo} title={`${t('撤销')} ${shortcutLabel('Mod+Z')}`} aria-label={t('撤销')}>
            <Undo2 size={15} />
          </button>
          <button type="button" className="tool-btn" onClick={() => editor.chain().focus().redo().run()} disabled={!state?.canRedo} title={`${t('重做')} ${shortcutLabel('Mod+Shift+Z')}`} aria-label={t('重做')}>
            <Redo2 size={15} />
          </button>
        </div>
        <div className="toolbar-divider" />
        <Dropdown
          trigger={
            <button type="button" className="tool-btn tool-btn-text" title={t('标题')} aria-label={t('标题')}>
              {headingLabel}
            </button>
          }
        >
          {(close) => (
            <>
              <MenuItem icon={<span className="mono" style={{ fontSize: 13 }}>¶</span>} detail={!state?.heading1 && !state?.heading2 && !state?.heading3 ? '✓' : undefined} onClick={() => { close(); editor.chain().focus().setParagraph().run(); }}>
                {t('正文')}
              </MenuItem>
              <MenuItem icon={<Heading1 size={15} />} onClick={() => { close(); editor.chain().focus().toggleHeading({ level: 1 }).run(); }}>{t('标题 1')}</MenuItem>
              <MenuItem icon={<Heading2 size={15} />} onClick={() => { close(); editor.chain().focus().toggleHeading({ level: 2 }).run(); }}>{t('标题 2')}</MenuItem>
              <MenuItem icon={<Heading3 size={15} />} onClick={() => { close(); editor.chain().focus().toggleHeading({ level: 3 }).run(); }}>{t('标题 3')}</MenuItem>
            </>
          )}
        </Dropdown>
        <div className="toolbar-divider" />
        <div className="toolbar-group">
          <button type="button" className={cn('tool-btn', state?.bold && 'active')} onClick={() => editor.chain().focus().toggleBold().run()} title={`${t('加粗')} ${shortcutLabel('Mod+B')}`} aria-label={t('加粗')}>
            <Bold size={15} />
          </button>
          <button type="button" className={cn('tool-btn', state?.italic && 'active')} onClick={() => editor.chain().focus().toggleItalic().run()} title={`${t('斜体')} ${shortcutLabel('Mod+I')}`} aria-label={t('斜体')}>
            <Italic size={15} />
          </button>
          <>
              <button type="button" className={cn('tool-btn', state?.underline && 'active')} onClick={() => editor.chain().focus().toggleUnderline().run()} title={`${t('下划线')} ${shortcutLabel('Mod+U')}`} aria-label={t('下划线')}>
                <UnderlineIcon size={15} />
              </button>
              <button type="button" className={cn('tool-btn', state?.strike && 'active')} onClick={() => editor.chain().focus().toggleStrike().run()} title={t('删除线')} aria-label={t('删除线')}>
                <Strikethrough size={15} />
              </button>
              <button type="button" className={cn('tool-btn', state?.code && 'active')} onClick={() => editor.chain().focus().toggleCode().run()} title={t('行内代码')} aria-label={t('行内代码')}>
                <Code size={15} />
              </button>
            </>
        </div>
        <div className="toolbar-divider" />
        <div className="toolbar-group">
          <button type="button" className={cn('tool-btn', state?.bulletList && 'active')} onClick={() => editor.chain().focus().toggleBulletList().run()} title={t('无序列表')} aria-label={t('无序列表')}>
            <List size={15} />
          </button>
          <button type="button" className={cn('tool-btn', state?.orderedList && 'active')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title={t('有序列表')} aria-label={t('有序列表')}>
            <ListOrdered size={15} />
          </button>
          <button type="button" className={cn('tool-btn', state?.taskList && 'active')} onClick={() => editor.chain().focus().toggleTaskList().run()} title={t('任务列表')} aria-label={t('任务列表')}>
            <ListChecks size={15} />
          </button>
          <button type="button" className={cn('tool-btn', state?.blockquote && 'active')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title={t('引用')} aria-label={t('引用')}>
            <Quote size={15} />
          </button>
          <button type="button" className={cn('tool-btn', state?.codeBlock && 'active')} onClick={() => editor.chain().focus().toggleCodeBlock().run()} title={t('代码块')} aria-label={t('代码块')}>
            <Code2 size={15} />
          </button>
        </div>
        <div className="toolbar-divider" />
        <div className="toolbar-group">
          <button type="button" className="tool-btn" onClick={onLink} title={t('插入链接')} aria-label={t('插入链接')}>
            <Link2 size={15} />
          </button>
          <button type="button" className="tool-btn" onClick={onWiki} title={t('双向链接')} aria-label={t('双向链接')}>
            <span className="mono" style={{ fontSize: 13, fontWeight: 700 }}>[[</span>
          </button>
          <button type="button" className="tool-btn" onClick={() => fileRef.current?.click()} title={t('上传图片或附件')} aria-label={t('上传图片或附件')}>
            <ImagePlus size={15} />
          </button>
          <Dropdown
            trigger={
              <button type="button" className="tool-btn" title={t('图片排版')} aria-label={t('图片排版')}>
                <LayoutGrid size={15} />
              </button>
            }
          >
            {(close) => (
              <>
                <MenuItem icon={<Columns2 size={15} />} detail={state?.imageGridColumns === 2 ? '✓' : undefined} onClick={() => { close(); onImageGrid(2); }}>{t('一排 2 张')}</MenuItem>
                <MenuItem icon={<Columns3 size={15} />} detail={state?.imageGridColumns === 3 ? '✓' : undefined} onClick={() => { close(); onImageGrid(3); }}>{t('一排 3 张')}</MenuItem>
                <MenuItem icon={<Columns4 size={15} />} detail={state?.imageGridColumns === 4 ? '✓' : undefined} onClick={() => { close(); onImageGrid(4); }}>{t('一排 4 张')}</MenuItem>
                <MenuItem icon={<Ungroup size={15} />} onClick={() => { close(); onUngroupImages(); }}>{t('拆分为单图')}</MenuItem>
              </>
            )}
          </Dropdown>
          <button type="button" className="tool-btn" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title={t('插入表格')} aria-label={t('插入表格')}>
            <Table2 size={15} />
          </button>
          <button type="button" className="tool-btn" onClick={() => editor.chain().focus().setHorizontalRule().run()} title={t('分割线')} aria-label={t('分割线')}>
            <Minus size={15} />
          </button>
        </div>
        {!isMobile && <div className="toolbar-spacer" />}
        <button
          type="button"
          className={cn('tool-btn', isMobile ? 'tool-btn-danger' : 'tool-btn-text tool-btn-danger')}
          onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
          title={t('清除格式')}
          aria-label={t('清除格式')}
        >
          <RemoveFormatting size={15} />
          {!isMobile && t('清除格式')}
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          multiple
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length) onImages(files);
            event.target.value = '';
          }}
        />
      </div>
      {state?.inTable && (
        <div className="table-toolbar" role="toolbar" aria-label={t('表格操作')}>
          <span className="table-toolbar-label">{t('表格')}</span>
          <Dropdown
            trigger={
              <button type="button" className="tool-btn tool-btn-text" title={t('行操作')} aria-label={t('行操作')}>
                <Rows3 size={14} /> {t('行')}
              </button>
            }
          >
            {(close) => (
              <>
                <MenuItem icon={<Plus size={14} />} onClick={() => { close(); editor.chain().focus().addRowBefore().run(); }}>{t('在上方添加行')}</MenuItem>
                <MenuItem icon={<Plus size={14} />} onClick={() => { close(); editor.chain().focus().addRowAfter().run(); }}>{t('在下方添加行')}</MenuItem>
                <MenuItem icon={<Minus size={14} />} onClick={() => { close(); editor.chain().focus().deleteRow().run(); }}>{t('删除当前行')}</MenuItem>
              </>
            )}
          </Dropdown>
          <Dropdown
            trigger={
              <button type="button" className="tool-btn tool-btn-text" title={t('列操作')} aria-label={t('列操作')}>
                <Columns3 size={14} /> {t('列')}
              </button>
            }
          >
            {(close) => (
              <>
                <MenuItem icon={<Plus size={14} />} onClick={() => { close(); editor.chain().focus().addColumnBefore().run(); }}>{t('在左侧添加列')}</MenuItem>
                <MenuItem icon={<Plus size={14} />} onClick={() => { close(); editor.chain().focus().addColumnAfter().run(); }}>{t('在右侧添加列')}</MenuItem>
                <MenuItem icon={<Minus size={14} />} onClick={() => { close(); editor.chain().focus().deleteColumn().run(); }}>{t('删除当前列')}</MenuItem>
              </>
            )}
          </Dropdown>
          <button type="button" className="tool-btn tool-btn-text table-delete" title={t('删除表格')} aria-label={t('删除表格')} onClick={() => editor.chain().focus().deleteTable().run()}>
            <Trash2 size={13} /> {t('删除表格')}
          </button>
        </div>
      )}
    </div>
  );
}
