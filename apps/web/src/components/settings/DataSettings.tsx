import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, CloudDownload, Download, FileCode2, FileJson, FileText, Trash2, UploadCloud } from 'lucide-react';
import { useAuthStore } from '../../stores/auth';
import { useAppStore } from '../../stores/app';
import { useT } from '../../lib/i18n';
import { clearSensitiveLocalData, setLocalWritesEnabled } from '../../lib/offline';
import { downloadBlob } from '../../lib/api';
import { toast } from '../../stores/toast';
import { ImportWizard } from './ImportWizard';
import { BackupPanel } from './BackupPanel';
import { OffsiteSettings } from './OffsiteSettings';

export default function DataSettings() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const workspaceId = useAppStore((state) => state.workspaceId);
  const workspace = useAuthStore((state) => state.workspaces.find((entry) => entry.id === workspaceId));
  const [importOpen, setImportOpen] = useState(params.get('import') === '1');
  const [exporting, setExporting] = useState<string | null>(null);
  const canManage = workspace?.role === 'owner' || workspace?.role === 'admin';

  useEffect(() => {
    if (params.get('import') === '1') setImportOpen(true);
  }, [params]);

  async function exportWorkspace(format: 'md' | 'html' | 'json') {
    if (!workspaceId) return;
    setExporting(format);
    try {
      await downloadBlob(`/api/export?workspaceId=${workspaceId}&format=${format}`, `360note-${workspace?.name ?? 'export'}.zip`);
    } catch (error) {
      toast('error', t('导出失败'), (error as Error).message);
    } finally {
      setExporting(null);
    }
  }

  async function clearLocalCache() {
    if (!window.confirm(t('清除本机离线数据会删除本机缓存的笔记正文、草稿和未同步队列，且无法恢复。确定继续？'))) return;
    await clearSensitiveLocalData();
    setLocalWritesEnabled(true);
    toast('success', t('已清除本机离线数据'));
  }

  function closeImport() {
    setImportOpen(false);
    if (params.get('import') === '1') {
      params.delete('import');
      setParams(params, { replace: true });
    }
  }

  if (!workspaceId) return null;

  return (
    <>
      <h1 className="settings-title">{t('数据与备份')}</h1>
      <p className="settings-subtitle">
        {t('你的数据属于你。这里的操作低频、重要，而且都可以撤销或验证。同步不是备份：同步会把误删传播到所有设备，备份不会。')}
      </p>

      <div className="banner banner-info" style={{ marginBottom: 26 }}>
        <CloudDownload size={15} />
        <div>{t('建议保留自动备份，并定期下载或配置异地存储。备份包含附件，导出使用开放格式，可随时重建。')}</div>
      </div>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('导出整个空间')}</span>
          <span className="settings-section-desc">{t('标准格式，不锁定')}</span>
        </div>
        <div className="export-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <button type="button" className="setting-card" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => void exportWorkspace('md')} disabled={Boolean(exporting)}>
            <FileText size={17} style={{ color: 'var(--blue)', marginBottom: 10 }} />
            <div className="setting-row-title">{t('Markdown + 附件')}</div>
            <div className="setting-note" style={{ marginTop: 4 }}>{t('保留文件夹层级、标签与时间戳。默认推荐。')}</div>
            <div style={{ marginTop: 10, fontSize: 13, color: 'var(--blue)' }}>{exporting === 'md' ? t('正在导出…') : t('下载 ZIP')}</div>
          </button>
          <button type="button" className="setting-card" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => void exportWorkspace('html')} disabled={Boolean(exporting)}>
            <FileCode2 size={17} style={{ color: 'var(--violet)', marginBottom: 10 }} />
            <div className="setting-row-title">{t('HTML 站点')}</div>
            <div className="setting-note" style={{ marginTop: 4 }}>{t('可直接浏览或托管的静态页面，保留链接与附件。')}</div>
            <div style={{ marginTop: 10, fontSize: 13, color: 'var(--blue)' }}>{exporting === 'html' ? t('正在导出…') : t('下载 ZIP')}</div>
          </button>
          <button type="button" className="setting-card" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => void exportWorkspace('json')} disabled={Boolean(exporting)}>
            <FileJson size={17} style={{ color: 'var(--green)', marginBottom: 10 }} />
            <div className="setting-row-title">{t('JSON 数据')}</div>
            <div className="setting-note" style={{ marginTop: 4 }}>{t('完整元数据与 Markdown 正文，适合迁移与自建工具。')}</div>
            <div style={{ marginTop: 10, fontSize: 13, color: 'var(--blue)' }}>{exporting === 'json' ? t('正在导出…') : t('下载 ZIP')}</div>
          </button>
        </div>
        <div className="info-line" style={{ marginTop: 10 }}>
          <Download size={13} />
          <span>{t('单篇笔记也可以从笔记右上角的“…”菜单导出为 Markdown、HTML 或 PDF，并保留附件。')}</span>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('导入笔记')}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setImportOpen(true)}>
            <UploadCloud size={13} /> {t('导入')}
          </button>
        </div>
        <p className="setting-note">{t('支持 Markdown、HTML、Evernote (.enex)、Notion 导出、CSV、JSON 与 ZIP。导入会先预览数量、文件夹层级与警告，再执行。')}</p>
        <div className="principles-grid steps-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 8, border: 0, background: 'transparent', marginTop: 12 }}>
          <div className="setting-card"><div className="setting-row-title">{t('1. 上传')}</div><p className="setting-note" style={{ marginTop: 4 }}>{t('选择文件或整个导出包。')}</p></div>
          <div className="setting-card"><div className="setting-row-title">{t('2. 预览')}</div><p className="setting-note" style={{ marginTop: 4 }}>{t('确认数量、层级与警告。')}</p></div>
          <div className="setting-card"><div className="setting-row-title">{t('3. 导入')}</div><p className="setting-note" style={{ marginTop: 4 }}>{t('创建新笔记，不覆盖已有内容。')}</p></div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('备份与时间点恢复')}</span>
          <span className="settings-section-desc">{t('与同步独立')}</span>
        </div>
        <BackupPanel workspaceId={workspaceId} canManage={canManage} />
      </section>

      <OffsiteSettings />

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('本机离线数据')}</span>
          <span className="settings-section-desc">{t('仅保存在此设备')}</span>
        </div>
        <p className="setting-note">
          {t('为支持弱网和离线编辑，笔记正文、草稿和待同步队列会以未加密形式暂存在浏览器 IndexedDB 中。退出登录不会删除它们，方便同一账号下次继续；切换账号时会自动清除上一个账号的数据。')}
        </p>
        <p className="setting-note">
          {t('在共用电脑上，请使用账户菜单中的“退出并清除本机数据”，或在下方立即清除。清除后未同步的编辑将无法恢复。')}
        </p>
        <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => void clearLocalCache()}>
          <Trash2 size={13} /> {t('清除本机离线数据')}
        </button>
      </section>

      <div className="banner banner-warning">
        <AlertTriangle size={15} />
        <div>
          <strong>{t('备份不等于同步。')}</strong> {t('同步会把误删和勒索加密传播到所有设备；备份不会。恢复操作会先创建安全备份，并在执行前展示预览。')}
        </div>
      </div>

      <ImportWizard open={importOpen} onClose={closeImport} workspaceId={workspaceId} />
    </>
  );
}
