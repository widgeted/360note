import { useEffect, useState } from 'react';
import { Copy, LockKeyhole, Sparkles, Wand2 } from 'lucide-react';
import type { Note } from '@360note/shared';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import { useT } from '../../lib/i18n';
import { copyText } from '../../lib/utils';
import { renderMarkdown } from '../../lib/markdown';
import { Modal } from '../Modal';
import { toast } from '../../stores/toast';

/** AI summary only. The old extractive "local summary" duplicated the note's
 * opening paragraphs and was removed deliberately. */
export function SummaryDialog({
  note,
  open,
  onClose,
  onInsert,
}: {
  note: Note;
  open: boolean;
  onClose: () => void;
  onInsert: (summary: string) => void;
}) {
  const t = useT();
  const instance = useAuthStore((state) => state.instance);
  const [summary, setSummary] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function generate() {
    if (!instance?.aiEnabled) return;
    setLoading(true);
    setSummary(null);
    try {
      const response = await api.post<{ summary: string; provider: string; warning?: string }>(
        '/api/ai/summarize',
        { noteId: note.id },
      );
      setSummary(response.summary);
      setProvider(response.provider);
      setWarning(response.warning ?? null);
    } catch (error) {
      toast('error', t('生成摘要失败'), (error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setSummary(null);
    setProvider(null);
    setWarning(null);
    if (instance?.aiEnabled) void generate();
    // Only the note and open state matter; generate is intentionally called
    // once when the user explicitly opens the summary action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, note.id]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('生成摘要')}
      description={t('只有你主动打开摘要时才会请求 AI 服务。')}
      size="md"
      footer={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>{t('关闭')}</button>
          {summary && (
            <>
              <button type="button" className="btn btn-secondary btn-sm" onClick={async () => { await copyText(summary); toast('success', t('已复制')); }}>
                <Copy size={13} /> {t('复制')}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => { onInsert(summary); onClose(); }}>
                <Wand2 size={13} /> {t('插入到笔记')}
              </button>
            </>
          )}
        </>
      }
    >
      {!instance?.aiEnabled ? (
        <div className="banner banner-warning">
          <LockKeyhole size={15} />
          <div>{t('实例管理员尚未启用 AI 摘要。')}</div>
        </div>
      ) : loading ? (
        <div className="loading-row">
          <span className="spinner" />
          {t('AI 正在阅读这篇笔记…')}
        </div>
      ) : summary ? (
        <div>
          <div className="banner banner-info" style={{ marginBottom: 14 }}>
            <Sparkles size={14} />
            <div>{provider} · {warning ?? t('摘要由你主动触发。')}</div>
          </div>
          <div className="prose" style={{ fontSize: 14 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(summary).html }} />
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => void generate()}>
            {t('重新生成')}
          </button>
        </div>
      ) : (
        <div className="context-empty">{t('摘要生成失败，请稍后重试。')}</div>
      )}
    </Modal>
  );
}
