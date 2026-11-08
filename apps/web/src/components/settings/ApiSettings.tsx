import { useEffect, useState } from 'react';
import { Bookmark, Check, Copy, KeyRound, Plus, Terminal, Trash2 } from 'lucide-react';
import type { ApiToken } from '@360note/shared';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import { useT } from '../../lib/i18n';
import { useIsMobile } from '../../lib/useMediaQuery';
import { copyText, formatRelativeShort } from '../../lib/utils';
import { Modal } from '../Modal';
import { toast } from '../../stores/toast';

export default function ApiSettings() {
  const t = useT();
  const isMobile = useIsMobile();
  const instance = useAuthStore((state) => state.instance);
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [writeAccess, setWriteAccess] = useState(true);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const response = await api.get<{ tokens: ApiToken[] }>('/api/tokens');
      setTokens(response.tokens);
    } catch {
      /* ignore */
    }
  }

  async function create() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const response = await api.post<{ token: string; id: string; scopes: string[] }>('/api/tokens', { name: name.trim(), scopes: writeAccess ? ['notes:read', 'notes:write'] : ['notes:read'] });
      setNewToken(response.token);
      setName('');
      await load();
    } catch (error) {
      toast('error', t('创建失败'), (error as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    if (revokeId !== id) {
      setRevokeId(id);
      return;
    }
    try {
      await api.delete(`/api/tokens/${id}`);
      await load();
      setRevokeId(null);
      toast('success', t('令牌已撤销'));
    } catch (error) {
      toast('error', t('操作失败'), (error as Error).message);
    }
  }

  async function copy(value: string, id: string) {
    await copyText(value);
    setCopied(id);
    setTimeout(() => setCopied(null), 1600);
  }

  const origin = instance?.publicOrigin ?? window.location.origin;
  const bookmarklet = `javascript:(()=>{const u=location.href,t=document.title,s=window.getSelection()?.toString()||'';window.open('${origin}/clip?url='+encodeURIComponent(u)+'&title='+encodeURIComponent(t)+'&text='+encodeURIComponent(s),'_blank')})()`;
  const curlExample = `curl -H "Authorization: Bearer nh_xxx" \\\n  "${origin}/api/notes?workspaceId=YOUR_WORKSPACE_ID&filter=all"`;

  return (
    <>
      <h1 className="settings-title">{t('API 与集成')}</h1>
      <p className="settings-subtitle">{t('用令牌连接脚本、剪藏工具或你自己的应用。令牌只显示一次，权限遵循最小化原则。')}</p>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('API 令牌')}</span>
          <span className="settings-section-desc">{t('笔记读写权限')}</span>
        </div>
        <div className="setting-inline-form" style={{ marginBottom: 14 }}>
          <div className="field">
            <label>{t('令牌名称')}</label>
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder={t('例如：我的脚本')} maxLength={80} />
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={create} disabled={creating || !name.trim()}>
            {creating ? <span className="spinner" /> : <Plus size={13} />} {t('创建令牌')}
          </button>
        </div>
        <label className="checkbox-row" style={{ marginBottom: 14 }}>
          <input type="checkbox" checked={writeAccess} onChange={(event) => setWriteAccess(event.target.checked)} />
          <span>
            <strong style={{ color: 'var(--text-soft)' }}>{t('允许写入笔记')}</strong>
            <span className="field-hint" style={{ display: 'block' }}>{t('关闭后令牌只能读取笔记、搜索和导出。')}</span>
          </span>
        </label>
        {tokens.length === 0 ? (
          <div className="context-empty">{t('暂无令牌')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {tokens.map((token) => (
              <div key={token.id} className="setting-card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10 }}>
                <KeyRound size={14} style={{ color: 'var(--text-tertiary)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 560 }}>{token.name} <span className="mono" style={{ fontWeight: 400, color: 'var(--text-tertiary)', fontSize: 13 }}>{token.prefix}…</span></div>
                  <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 2 }}>
                    {token.revokedAt ? t('已撤销') : token.lastUsedAt ? `${t('最后使用')} ${formatRelativeShort(token.lastUsedAt)}` : t('尚未使用')} · {token.scopes.join(', ')}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void revoke(token.id)}
                  disabled={Boolean(token.revokedAt)}
                  style={revokeId === token.id ? { color: 'var(--red)', background: 'var(--red-soft)' } : undefined}
                >
                  {revokeId === token.id ? <Check size={12} /> : <Trash2 size={12} />} {revokeId === token.id ? t('再次点击确认') : ''}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('网页剪藏')}</span>
          <span className="settings-section-desc">{t('浏览器书签')}</span>
        </div>
        <p className="setting-note">
          {isMobile
            ? t('移动端可以复制下面的脚本，在桌面浏览器中创建书签；也可以直接打开剪藏页面手动粘贴网址与文字。')
            : t('把下面的脚本拖到书签栏，或复制后新建一个书签。在任意网页点击它，就会打开 360笔记的剪藏页面，并预填标题、网址与选中的文字。')}
        </p>
        <div className="share-link-box" style={{ marginTop: 10 }}>
          <Bookmark size={13} style={{ color: 'var(--text-tertiary)', flex: 'none' }} />
          <input readOnly value={bookmarklet} onFocus={(event) => event.target.select()} />
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy(bookmarklet, 'bookmarklet')}>
            {copied === 'bookmarklet' ? <Check size={12} /> : <Copy size={12} />} {t('复制')}
          </button>
        </div>
        <div className="setting-note" style={{ marginTop: 6 }}>{t('剪藏页面需要登录 360note。脚本不会在第三方页面发送你的 Cookie。')}</div>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title"><Terminal size={13} style={{ display: 'inline', marginRight: 5 }} />{t('API 文档')}</span>
          <span className="settings-section-desc">REST · JSON</span>
        </div>
        <p className="setting-note">{t('用 Bearer 令牌调用接口。令牌拥有当前账户的读写权限，请不要把它提交到公开仓库。')}</p>
        <div className="code-block" style={{ marginTop: 10 }}>{curlExample}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
          <div className="setting-card">
            <div className="setting-row-title mono" style={{ fontSize: 13 }}>GET /api/notes</div>
            <p className="setting-note">{t('列出笔记，支持 workspaceId、filter、q、limit、offset。')}</p>
          </div>
          <div className="setting-card">
            <div className="setting-row-title mono" style={{ fontSize: 13 }}>POST /api/notes</div>
            <p className="setting-note">{t('创建笔记，正文使用 Markdown。')}</p>
          </div>
          <div className="setting-card">
            <div className="setting-row-title mono" style={{ fontSize: 13 }}>GET /api/search</div>
            <p className="setting-note">{t('全文搜索标题、正文、标签与附件名。')}</p>
          </div>
          <div className="setting-card">
            <div className="setting-row-title mono" style={{ fontSize: 13 }}>GET /api/export</div>
            <p className="setting-note">{t('导出整个空间为 ZIP。')}</p>
          </div>
        </div>
      </section>

      <div className="banner banner-warning">
        <KeyRound size={15} />
        <div>{t('令牌等同于密码。如果令牌泄露，请立即撤销并创建新的。所有 API 请求仍受空间角色与限流约束。')}</div>
      </div>

      <Modal
        open={Boolean(newToken)}
        onClose={() => setNewToken(null)}
        title={t('令牌只显示一次')}
        description={t('请立即复制并保存在安全位置。关闭后无法再次查看。')}
        size="sm"
        footer={<button type="button" className="btn btn-primary btn-sm" onClick={() => setNewToken(null)}>{t('我已保存')}</button>}
      >
        <div className="share-link-box">
          <input readOnly value={newToken ?? ''} onFocus={(event) => event.target.select()} />
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => newToken && void copy(newToken, 'new-token')}>
            {copied === 'new-token' ? <Check size={12} /> : <Copy size={12} />} {t('复制')}
          </button>
        </div>
        <div className="banner banner-warning" style={{ marginTop: 12 }}><KeyRound size={14} /><div>{t('不要通过邮件、聊天或截图分享令牌。')}</div></div>
      </Modal>
    </>
  );
}
