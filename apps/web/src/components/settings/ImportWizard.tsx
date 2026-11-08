import { useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  FileArchive,
  FileText,
  FolderTree,
  Loader2,
  UploadCloud,
  X,
} from 'lucide-react';
import type { ImportPreview, JobInfo } from '@360note/shared';
import { api } from '../../lib/api';
import { useIsMobile } from '../../lib/useMediaQuery';
import { useAppStore } from '../../stores/app';
import { useT } from '../../lib/i18n';
import { formatBytes, sleep } from '../../lib/utils';
import { Modal } from '../Modal';
import { toast } from '../../stores/toast';

type Step = 'choose' | 'analyzing' | 'preview' | 'importing' | 'done';

export function ImportWizard({ open, onClose, workspaceId }: { open: boolean; onClose: () => void; workspaceId: string }) {
  const t = useT();
  const [step, setStep] = useState<Step>('choose');
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewJobId, setPreviewJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const isMobile = useIsMobile();
  const fileRef = useRef<HTMLInputElement>(null);
  const pollId = useRef(0);

  function reset() {
    setStep('choose');
    setFiles([]);
    setPreview(null);
    setPreviewJobId(null);
    setProgress(0);
    setMessage(null);
    setResult(null);
    setError(null);
  }

  function close() {
    pollId.current++;
    reset();
    onClose();
  }

  function addFiles(next: FileList | File[]) {
    const list = [...files, ...Array.from(next)].filter((file, index, array) => array.findIndex((entry) => entry.name === file.name && entry.size === file.size) === index);
    setFiles(list.slice(0, 40));
  }

  async function startAnalyze() {
    if (!files.length) return;
    setStep('analyzing');
    setProgress(1);
    setMessage(t('正在上传并分析…'));
    setError(null);
    const token = ++pollId.current;
    try {
      const form = new FormData();
      for (const file of files) form.append('files', file, file.name);
      const response = await api.upload<{ jobId: string }>(`/api/import/upload?workspaceId=${workspaceId}`, form);
      setPreviewJobId(response.jobId);
      while (pollId.current === token) {
        await sleep(700);
        const job = await api.get<{ job: JobInfo }>(`/api/import/${response.jobId}`);
        setProgress(Math.max(job.job.progress, 2));
        setMessage(job.job.message ?? t('正在分析…'));
        if (job.job.status === 'error') throw new Error(job.job.error ?? t('导入分析失败'));
        if (job.job.status === 'done') {
          const previewData = (job.job.result as { preview?: ImportPreview } | null)?.preview;
          if (!previewData) throw new Error(t('导入分析失败'));
          setPreview(previewData);
          setStep('preview');
          return;
        }
      }
    } catch (error) {
      if (pollId.current === token) {
        setError((error as Error).message);
        setStep('choose');
      }
    }
  }

  async function execute() {
    if (!previewJobId) return;
    setStep('importing');
    setProgress(2);
    setMessage(t('正在创建笔记…'));
    const token = ++pollId.current;
    try {
      const response = await api.post<{ jobId: string }>(`/api/import/${previewJobId}/execute`, {});
      while (pollId.current === token) {
        await sleep(650);
        const job = await api.get<{ job: JobInfo }>(`/api/jobs/${response.jobId}`);
        setProgress(job.job.progress);
        setMessage(job.job.message ?? t('正在导入…'));
        if (job.job.status === 'error') throw new Error(job.job.error ?? t('导入失败'));
        if (job.job.status === 'done') {
          setResult(job.job.result);
          setStep('done');
          await useAppStore.getState().refreshAll();
          toast('success', t('导入完成'));
          return;
        }
      }
    } catch (error) {
      setError((error as Error).message);
      setStep('preview');
    }
  }

  const footer =
    step === 'choose' ? (
      <>
        <button type="button" className="btn btn-secondary btn-sm" onClick={close}>{t('取消')}</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={startAnalyze} disabled={!files.length}>
          <UploadCloud size={13} /> {t('开始导入')}
        </button>
      </>
    ) : step === 'preview' ? (
      <>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setStep('choose'); setPreview(null); }}>{t('重新选择')}</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={execute}>
          {t('执行导入')} <ArrowRight size={13} />
        </button>
      </>
    ) : step === 'done' ? (
      <button type="button" className="btn btn-primary btn-sm" onClick={close}>{t('完成')}</button>
    ) : undefined;

  return (
    <Modal
      open={open}
      onClose={close}
      title={t('导入笔记')}
      description={step === 'choose' ? t('支持 Markdown、HTML、Evernote、Notion、CSV、JSON 和 ZIP。导入会创建新笔记，不会修改已有内容。') : undefined}
      size="lg"
      footer={footer}
    >
      {error && <div className="form-error" style={{ marginBottom: 12 }}><AlertCircle size={14} /> {error}</div>}

      {step === 'choose' && (
        <>
          <div
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}
            className={dragging ? 'drag-over' : ''}
            style={{
              border: '1px dashed var(--line-strong)',
              borderRadius: 10,
              padding: '30px 20px',
              textAlign: 'center',
              background: 'var(--paper-50)',
              cursor: 'pointer',
            }}
            onClick={() => fileRef.current?.click()}
          >
            <UploadCloud size={24} style={{ color: 'var(--text-tertiary)', margin: '0 auto 10px' }} />
            <div style={{ fontSize: 13, fontWeight: 570 }}>{isMobile ? t('点击选择文件') : t('拖入文件或点击选择')}</div>
            <div className="setting-note" style={{ marginTop: 4 }}>{t('支持 Markdown、HTML、Evernote、Notion、CSV、JSON 和 ZIP')}</div>
            <input
              ref={fileRef}
              type="file"
              hidden
              multiple
              accept=".zip,.enex,.md,.markdown,.html,.htm,.csv,.json,.txt"
              onChange={(event) => event.target.files && addFiles(event.target.files)}
            />
          </div>
          {files.length > 0 && (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 5 }}>
              {files.map((file) => (
                <div key={`${file.name}-${file.size}`} className="attachment-item" style={{ padding: '7px 9px', border: '1px solid var(--line)', borderRadius: 7, background: 'var(--surface)' }}>
                  <span style={{ color: 'var(--text-tertiary)' }}><FileArchive size={14} /></span>
                  <div className="attachment-meta">
                    <div className="attachment-name">{file.name}</div>
                    <div className="attachment-size">{formatBytes(file.size)}</div>
                  </div>
                  <button type="button" className="icon-btn icon-btn-sm" onClick={() => setFiles(files.filter((entry) => entry !== file))} aria-label={t('移除')}><X size={12} /></button>
                </div>
              ))}
            </div>
          )}
          <div className="info-line" style={{ marginTop: 12 }}>
            <AlertCircle size={13} />
            <span>{t('单次最多 3000 篇笔记、250 MB。Evernote 附件会被保存为普通附件。')}</span>
          </div>
        </>
      )}

      {(step === 'analyzing' || step === 'importing') && (
        <div style={{ padding: '28px 20px 22px', textAlign: 'center' }}>
          <Loader2 size={28} className="spinner" style={{ margin: '0 auto 14px', animation: 'spin .8s linear infinite' }} />
          <div style={{ fontSize: 13, fontWeight: 600 }}>{step === 'analyzing' ? t('正在分析导入内容…') : t('正在导入…')}</div>
          <div className="setting-note" style={{ marginTop: 4 }}>{message}</div>
          <div className="progress" style={{ marginTop: 18, maxWidth: 340, marginInline: 'auto' }}>
            <div className="progress-bar" style={{ width: `${Math.max(progress, 3)}%` }} />
          </div>
        </div>
      )}

      {step === 'preview' && preview && (
        <div>
          <div className="import-counts" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
            <div className="setting-card" style={{ padding: 12 }}><div style={{ fontSize: 22, fontFamily: 'var(--font-ui)' }}>{preview.noteCount}</div><div className="setting-note">{t('笔记')}</div></div>
            <div className="setting-card" style={{ padding: 12 }}><div style={{ fontSize: 22, fontFamily: 'var(--font-ui)' }}>{preview.attachmentCount}</div><div className="setting-note">{t('附件')}</div></div>
            <div className="setting-card" style={{ padding: 12 }}><div style={{ fontSize: 22, fontFamily: 'var(--font-ui)' }}>{preview.folders.length}</div><div className="setting-note">{t('文件夹')}</div></div>
          </div>
          <div className="setting-note" style={{ marginBottom: 10 }}>
            {t('来源')}：<span className="badge">{preview.source}</span> · {t('导入会创建新笔记，不会修改已有内容。')}
          </div>
          {preview.folders.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div className="context-section-title"><span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><FolderTree size={12} /> {t('将创建的文件层级')}</span></div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {preview.folders.slice(0, 20).map((folder) => <span className="mini-tag" key={folder}>{folder}</span>)}
              </div>
            </div>
          )}
          <div className="context-section-title"><span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><FileText size={12} /> {t('示例')}</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 190, overflowY: 'auto' }}>
            {preview.samples.map((sample, index) => (
              <div key={index} style={{ padding: '7px 9px', borderRadius: 6, border: '1px solid var(--line)', background: 'var(--surface)' }}>
                <div style={{ fontSize: 13, fontWeight: 550 }}>{sample.title}</div>
                <div className="setting-note" style={{ marginTop: 2 }}>{sample.folder ? `${sample.folder} · ` : ''}{sample.excerpt}</div>
              </div>
            ))}
          </div>
          {preview.warnings.length > 0 && (
            <div className="banner banner-warning" style={{ marginTop: 14 }}>
              <AlertCircle size={14} />
              <div>
                <strong>{t('警告')}</strong>
                <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                  {preview.warnings.slice(0, 6).map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 'done' && (
        <div style={{ textAlign: 'center', padding: '24px 20px' }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--green-soft)', color: 'var(--green)', display: 'grid', placeItems: 'center', margin: '0 auto 14px' }}>
            <Check size={22} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 650 }}>{t('导入完成')}</div>
          <p className="setting-note" style={{ marginTop: 6 }}>
            {t('已导入 {n} 篇笔记、{m} 个附件', { n: Number(result?.imported ?? 0), m: Number(result?.attachments ?? 0) })}
            {Number(result?.skipped ?? 0) > 0 && ` · ${t('跳过 {n} 篇', { n: Number(result?.skipped) })}`}
          </p>
          <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 14 }} onClick={() => { close(); useAppStore.getState().setFilter('all'); }}>
            {t('查看全部笔记')}
          </button>
        </div>
      )}
    </Modal>
  );
}
