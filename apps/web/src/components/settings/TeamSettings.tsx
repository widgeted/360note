import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  Check,
  Copy,
  Crown,
  LogOut,
  MailPlus,
  Plus,
  Shield,
  ShieldAlert,
  Trash2,
  UserMinus,
  UserRound,
  UserLock,
  UsersRound,
  KeyRound,
  LockKeyhole,
} from 'lucide-react';
import type { AuditEntry, Invitation, User, WorkspaceMember } from '@360note/shared';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import { useAppStore } from '../../stores/app';
import { getLocale, useT } from '../../lib/i18n';
import { auditActionLabel } from '../../lib/audit';
import { copyText, formatFullDate, formatRelativeShort } from '../../lib/utils';
import { Avatar } from '../Avatar';
import { ConfirmDialog, Modal } from '../Modal';
import { toast } from '../../stores/toast';
import { LoadFailure } from '../LoadFailure';
import { useVaultStore } from '../../stores/vault';

const ROLES = ['admin', 'editor', 'viewer'] as const;

export default function TeamSettings() {
  const t = useT();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAuthStore((state) => state.user);
  const workspaces = useAuthStore((state) => state.workspaces);
  const refreshAuth = useAuthStore((state) => state.refresh);
  const workspaceId = useAppStore((state) => state.workspaceId);
  const initialize = useAppStore((state) => state.initialize);
  const workspace = workspaces.find((entry) => entry.id === workspaceId);
  const canManage = workspace?.role === 'owner' || workspace?.role === 'admin';
  const isOwner = workspace?.role === 'owner';

  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<Array<Invitation & { url?: string }>>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [name, setName] = useState(workspace?.name ?? '');
  const [icon, setIcon] = useState(workspace?.icon ?? '📔');
  const [color, setColor] = useState(workspace?.color ?? '#17865b');
  const [savingName, setSavingName] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'editor' | 'viewer'>('editor');
  const [inviting, setInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [removeMember, setRemoveMember] = useState<WorkspaceMember | null>(null);
  const [ownerTarget, setOwnerTarget] = useState<WorkspaceMember | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createKind, setCreateKind] = useState<'personal' | 'team' | 'vault'>('team');
  const [createIcon, setCreateIcon] = useState('👥');
  const [createColor, setCreateColor] = useState('#17865b');
  const [createOpen, setCreateOpen] = useState(searchParams.get('create') === '1');
  const [creating, setCreating] = useState(false);
  const [vaultPassword, setVaultPassword] = useState('');
  const [vaultPasswordConfirm, setVaultPasswordConfirm] = useState('');
  const [recoveryDialog, setRecoveryDialog] = useState<string | null>(null);
  const [recoveryAfterCreate, setRecoveryAfterCreate] = useState(false);
  const [vaultCurrentPassword, setVaultCurrentPassword] = useState('');
  const [vaultNewPassword, setVaultNewPassword] = useState('');
  const [vaultNewPasswordConfirm, setVaultNewPasswordConfirm] = useState('');
  const [vaultRecoveryPassword, setVaultRecoveryPassword] = useState('');
  const [vaultBusy, setVaultBusy] = useState(false);
  const [vaultPasswordOpen, setVaultPasswordOpen] = useState(false);
  const [vaultRecoveryOpen, setVaultRecoveryOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setCreateOpen(searchParams.get('create') === '1');
  }, [searchParams]);

  useEffect(() => {
    setName(workspace?.name ?? '');
    setIcon(workspace?.icon ?? (workspace?.kind === 'team' ? '👥' : workspace?.kind === 'vault' ? '🔒' : '📔'));
    setColor(workspace?.color ?? '#17865b');
    setLoadError(null);
    if (!workspaceId) return;
    if (workspace?.kind === 'vault') {
      // Vaults have no members or invitations; only load the audit log.
      if (canManage) void loadAudit();
      return;
    }
    void loadMembers();
    if (canManage) {
      void loadInvitations();
      void loadAudit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, canManage, workspace?.name, workspace?.icon, workspace?.color]);

  async function loadMembers() {
    try {
      const response = await api.get<{ members: WorkspaceMember[] }>(`/api/workspaces/${workspaceId}/members`);
      setMembers(response.members);
      setLoadError(null);
    } catch (error) {
      setLoadError((error as Error).message);
    }
  }

  async function loadInvitations() {
    try {
      const response = await api.get<{ invitations: Array<Invitation & { url?: string }> }>(`/api/workspaces/${workspaceId}/invitations`);
      setInvitations(response.invitations);
    } catch (error) {
      setLoadError((error as Error).message);
    }
  }

  async function loadAudit() {
    try {
      const response = await api.get<{ entries: AuditEntry[] }>(`/api/workspaces/${workspaceId}/audit`);
      setAudit(response.entries);
    } catch (error) {
      setLoadError((error as Error).message);
    }
  }

  async function saveName() {
    if (!workspaceId || !name.trim()) return;
    setSavingName(true);
    try {
      await api.patch(`/api/workspaces/${workspaceId}`, { name: name.trim(), icon, color });
      await refreshAuth();
      toast('success', t('设置已保存'));
    } catch (error) {
      toast('error', t('保存失败'), (error as Error).message);
    } finally {
      setSavingName(false);
    }
  }

  async function invite() {
    if (!workspaceId || !inviteEmail.trim()) return;
    setInviting(true);
    setError(null);
    try {
      const response = await api.post<{ invitation: Invitation & { url?: string }; emailSent: boolean }>(
        `/api/workspaces/${workspaceId}/invitations`,
        { email: inviteEmail.trim(), role: inviteRole },
      );
      setInvitations((current) => [response.invitation, ...current]);
      setInviteLink(response.invitation.url ?? null);
      setInviteEmail('');
      toast(
        'success',
        t('邀请已创建'),
        response.emailSent ? t('邀请邮件已发送。你也可以复制链接发给对方。') : t('邮件未发送。请复制邀请链接发给对方。'),
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setInviting(false);
    }
  }

  async function changeRole(member: WorkspaceMember, role: string) {
    if (role === 'owner') {
      setOwnerTarget(member);
      return;
    }
    await applyRole(member, role);
  }

  async function applyRole(member: WorkspaceMember, role: string) {
    try {
      await api.patch(`/api/workspaces/${workspaceId}/members/${member.userId}`, { role });
      await loadMembers();
      await refreshAuth();
      toast('success', t('角色已更新'));
    } catch (error) {
      toast('error', t('操作失败'), (error as Error).message);
    }
  }

  async function confirmRemove() {
    if (!removeMember) return;
    try {
      await api.delete(`/api/workspaces/${workspaceId}/members/${removeMember.userId}`);
      setRemoveMember(null);
      await loadMembers();
      toast('success', t('成员已移除'));
    } catch (error) {
      toast('error', t('操作失败'), (error as Error).message);
    }
  }

  async function revokeInvitation(id: string) {
    try {
      await api.delete(`/api/workspaces/${workspaceId}/invitations/${id}`);
      setInvitations((current) => current.filter((entry) => entry.id !== id));
    } catch (error) {
      toast('error', t('操作失败'), (error as Error).message);
    }
  }

  async function createWorkspace() {
    if (!createName.trim()) return;
    setCreating(true);
    try {
      const response = await api.post<{ workspace: { id: string; name: string }; recoveryKey?: string; vaultToken?: string }>('/api/workspaces', {
        name: createName.trim(),
        kind: createKind,
        icon: createIcon || (createKind === 'team' ? '👥' : createKind === 'vault' ? '🔒' : '📔'),
        color: createColor,
        ...(createKind === 'vault' ? { vaultPassword } : {}),
      });
      await refreshAuth();
      localStorage.setItem('nh-workspace', response.workspace.id);
      if (createKind === 'vault') {
        if (response.vaultToken) useVaultStore.getState().setToken(response.workspace.id, response.vaultToken);
        useAppStore.getState().selectWorkspace(response.workspace.id);
        await initialize(response.workspace.id, { vault: true });
        closeCreate();
        if (response.recoveryKey) {
          // Keep the settings page mounted until the user saves the one-time key.
          setRecoveryAfterCreate(true);
          setRecoveryDialog(response.recoveryKey);
          toast('success', t('加密空间已创建'));
          return;
        }
      } else {
        await initialize(response.workspace.id);
      }
      closeCreate();
      navigate('/app');
      toast('success', createKind === 'personal' ? t('个人空间已创建') : createKind === 'vault' ? t('加密空间已创建') : t('团队空间已创建'));
    } catch (error) {
      toast('error', t('创建失败'), (error as Error).message);
    } finally {
      setCreating(false);
    }
  }

  function closeCreate() {
    setCreateOpen(false);
    setCreateName('');
    setCreateKind('team');
    setCreateIcon('👥');
    setCreateColor('#17865b');
    setVaultPassword('');
    setVaultPasswordConfirm('');
    if (searchParams.get('create') === '1') {
      const next = new URLSearchParams(searchParams);
      next.delete('create');
      setSearchParams(next, { replace: true });
    }
  }

  async function deleteWorkspace() {
    try {
      await api.delete(`/api/workspaces/${workspaceId}`);
      await refreshAuth();
      localStorage.removeItem('nh-workspace');
      setDeleteOpen(false);
      navigate('/app');
    } catch (error) {
      toast('error', t('删除失败'), (error as Error).message);
    }
  }

  async function leaveWorkspace() {
    try {
      await api.post(`/api/workspaces/${workspaceId}/leave`);
      await refreshAuth();
      localStorage.removeItem('nh-workspace');
      setLeaveOpen(false);
      navigate('/app');
    } catch (error) {
      toast('error', t('操作失败'), (error as Error).message);
    }
  }

  async function switchSpace(id: string) {
    if (id === workspaceId) return;
    if (workspace?.kind === 'vault') await useVaultStore.getState().lock(workspace.id);
    localStorage.setItem('nh-workspace', id);
    useAppStore.getState().selectWorkspace(id);
    await refreshAuth();
    // Stay on Spaces settings so the newly selected space's controls are
    // immediately visible. Switching from the sidebar still goes to notes.
  }

  async function changeVaultPassword() {
    if (vaultNewPassword !== vaultNewPasswordConfirm) {
      toast('error', t('两次输入的密码不一致'));
      return;
    }
    setVaultBusy(true);
    try {
      await useVaultStore.getState().changePassword(workspaceId!, vaultCurrentPassword, vaultNewPassword);
      setVaultPasswordOpen(false);
      setVaultCurrentPassword('');
      setVaultNewPassword('');
      setVaultNewPasswordConfirm('');
      toast('success', t('空间密码已更新'));
    } catch (error) {
      toast('error', t('操作失败'), (error as Error).message);
    } finally {
      setVaultBusy(false);
    }
  }

  async function regenerateVaultRecovery() {
    setVaultBusy(true);
    try {
      const key = await useVaultStore.getState().regenerateRecovery(workspaceId!, vaultRecoveryPassword);
      setVaultRecoveryPassword('');
      setVaultRecoveryOpen(false);
      setRecoveryAfterCreate(false);
      setRecoveryDialog(key);
    } catch (error) {
      toast('error', t('操作失败'), (error as Error).message);
    } finally {
      setVaultBusy(false);
    }
  }

  async function lockVaultNow() {
    if (!workspaceId) return;
    await useVaultStore.getState().lock(workspaceId);
    window.dispatchEvent(new Event('nh:vault-locked'));
  }

  function copy(value: string, id: string) {
    void copyText(value).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <>
      <h1 className="settings-title">{t('空间')}</h1>
      <p className="settings-subtitle">{t('每个账户始终有一个个人空间；团队空间用于多人协作；加密空间使用独立密码派生密钥。可以创建多个空间并随时切换。')}</p>

      {loadError && <LoadFailure message={loadError} onRetry={() => { void loadMembers(); if (canManage) { void loadInvitations(); void loadAudit(); } }} />}

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('空间概览')}</span>
          <span className="settings-section-desc">{workspaces.length} {t('个空间')}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {workspaces.map((entry) => (
            <div key={entry.id} className="setting-card space-overview-row">
              <span
                className="workspace-mark space-overview-mark"
                style={{
                  background: `${entry.color ?? '#17865b'}24`,
                  borderColor: `${entry.color ?? '#17865b'}40`,
                  color: entry.color ?? 'var(--blue)',
                }}
              >
                {entry.icon ?? '📔'}
              </span>
              <div className="space-overview-main">
                <div className="space-overview-title">
                  <span className="space-overview-name">{entry.name}</span>
                  <span className="workspace-kind-icon" title={entry.kind === 'team' ? t('团队空间') : entry.kind === 'vault' ? t('加密空间') : t('个人空间')} aria-label={entry.kind === 'team' ? t('团队空间') : entry.kind === 'vault' ? t('加密空间') : t('个人空间')}>
                    {entry.kind === 'team' ? <UsersRound size={12} /> : entry.kind === 'vault' ? <UserLock size={12} /> : <UserRound size={12} />}
                  </span>
                  {entry.id === workspaceId && <span className="badge badge-green">{t('当前')}</span>}
                </div>
                <div className="space-overview-meta">
                  {entry.kind === 'team' ? t('成员 {n} 人', { n: entry.memberCount ?? 1 }) : entry.kind === 'vault' ? t('密码保护，只有你可以访问') : t('只有你可以访问')} · {roleLabel(t, entry.role)}
                </div>
              </div>
              {entry.id !== workspaceId && (
                <button type="button" className="btn btn-secondary btn-sm space-overview-action" onClick={() => void switchSpace(entry.id)}>
                  {t('切换')}
                </button>
              )}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
            <Plus size={13} /> {t('创建空间')}
          </button>
        </div>
        <p className="setting-note" style={{ marginTop: 10 }}>
          {t('个人空间只有你可见；团队空间用于协作；加密空间使用独立密码派生密钥，内容不可分享、评论、双链或导出。')}
        </p>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('当前空间')}</span>
          <span className="settings-section-desc">{workspace?.kind === 'team' ? t('团队空间') : workspace?.kind === 'vault' ? t('加密空间') : t('个人空间')}</span>
        </div>
        <div className="setting-card">
          <div className="setting-inline-form">
            <div className="field field-icon">
              <label>{t('图标')}</label>
              <input
                className="input"
                value={icon}
                onChange={(event) => setIcon(event.target.value.slice(0, 4))}
                disabled={!canManage}
                maxLength={4}
                style={{ textAlign: 'center', fontSize: 18 }}
                aria-label={t('空间图标')}
              />
            </div>
            <div className="field">
              <label>{t('空间名称')}</label>
              <input className="input" value={name} onChange={(event) => setName(event.target.value)} disabled={!canManage} maxLength={80} />
            </div>
            {canManage && (
              <button type="button" className="btn btn-primary btn-sm" onClick={saveName} disabled={savingName || (name.trim() === workspace?.name && icon === workspace?.icon && color === workspace?.color)}>
                {savingName && <span className="spinner" />} {t('保存')}
              </button>
            )}
          </div>
          {canManage && (
            <IdentityPicker icon={icon} color={color} onIcon={setIcon} onColor={setColor} />
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, fontSize: 13, color: 'var(--text-tertiary)' }}>
            {workspace?.kind === 'vault' ? <UserLock size={12} /> : workspace?.kind === 'team' ? <UsersRound size={12} /> : <UserRound size={12} />}{' '}
            {workspace?.kind === 'vault'
              ? t('仅所有者')
              : getLocale() === 'en'
                ? `${workspace?.memberCount ?? members.length} member${(workspace?.memberCount ?? members.length) === 1 ? '' : 's'}`
                : t('{n} 位成员', { n: workspace?.memberCount ?? members.length })}
            <span className="dot" />
            {t('你的角色：{role}', { role: roleLabel(t, workspace?.role ?? '') })}
            {workspace?.kind === 'personal' ? <><span className="dot" />{t('只有你可以访问')}</> : workspace?.kind === 'vault' ? <><span className="dot" />{t('密码派生加密')}</> : <><span className="dot" />{t('可邀请成员协作')}</>}
          </div>
          <p className="setting-note" style={{ marginTop: 10 }}>
            {workspace?.kind === 'personal'
              ? t('个人空间是只有你可见的私有空间，不能邀请成员；它可以重命名，也可以在有多个空间时删除。')
              : workspace?.kind === 'vault'
                ? t('加密空间使用空间密码派生密钥加密正文与附件；不支持成员、邀请、分享、评论、双链、导出或备份。15 分钟无操作后自动锁定。')
                : t('团队空间用于多人协作，支持成员角色、邀请链接与审计日志，可转移所有权或删除。')}
          </p>
        </div>
      </section>

      {workspace?.kind === 'vault' && (
        <>
          <section className="settings-section">
            <div className="settings-section-head">
              <span className="settings-section-title">{t('空间安全')}</span>
              <span className="settings-section-desc">{t('密码派生加密')}</span>
            </div>
            <div className="setting-card">
              <div className="setting-row">
                <div className="setting-row-main">
                  <div className="setting-row-title">{t('修改空间密码')}</div>
                  <div className="setting-row-desc">{t('修改后其他设备会立即锁定；正文不需要重新加密。')}</div>
                </div>
                <div className="setting-row-control">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setVaultPasswordOpen(true)}><KeyRound size={13} /> {t('修改密码')}</button>
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-row-main">
                  <div className="setting-row-title">{t('重新生成恢复密钥')}</div>
                  <div className="setting-row-desc">{t('旧恢复密钥会立即失效。新密钥只显示一次。')}</div>
                </div>
                <div className="setting-row-control">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setVaultRecoveryOpen(true)} disabled={vaultBusy}><KeyRound size={13} /> {t('重新生成')}</button>
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-row-main">
                  <div className="setting-row-title">{t('立即锁定')}</div>
                  <div className="setting-row-desc">{t('清除本标签页的内存密钥，再次进入需要重新输入空间密码。')}</div>
                </div>
                <div className="setting-row-control">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void lockVaultNow()}><LockKeyhole size={13} /> {t('锁定')}</button>
                </div>
              </div>
            </div>
          </section>
        </>
      )}

      {workspace?.kind !== 'vault' && (workspace?.kind === 'personal' ? (
        <section className="settings-section">
          <div className="settings-section-head"><span className="settings-section-title">{t('需要协作？')}</span></div>
          <div className="banner banner-info">
            <UsersRound size={15} />
            <div>{t('团队空间让多位成员共享文件夹、标签与笔记，并拥有独立成员角色、邀请与审计日志。个人空间保持简单，只属于你。')}</div>
          </div>
          <p className="setting-note" style={{ marginTop: 10 }}>
            {t('使用上方“创建空间”即可创建团队空间或加密空间。')}
          </p>
        </section>
      ) : (
        <>
          <section className="settings-section">
            <div className="settings-section-head">
              <span className="settings-section-title">{t('成员')}</span>
              <span className="settings-section-desc">{t('{n} 人', { n: members.length })}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {members.map((member) => (
                <div key={member.userId} className="setting-card member-row">
                  <Avatar name={member.displayName} color={member.avatarColor} size="sm" />
                  <div className="member-main">
                    <div className="member-name-line">
                      <span className="member-name">{member.displayName}</span>
                      {member.userId === user?.id && <span className="badge">{t('你')}</span>}
                      {member.role === 'owner' && <Crown size={11} style={{ color: 'var(--amber)' }} />}
                      {!(canManage && member.role !== 'owner') && <span className="badge">{roleLabel(t, member.role)}</span>}
                    </div>
                    <div className="member-meta">{member.email} · {t('加入于 {date}', { date: formatRelativeShort(member.joinedAt) })}</div>
                  </div>
                  {canManage && member.role !== 'owner' && (
                    <div className="member-actions">
                      <select className="select select-sm" value={member.role} onChange={(event) => void changeRole(member, event.target.value)} style={{ width: 100 }}>
                        {ROLES.map((role) => <option key={role} value={role}>{roleLabel(t, role)}</option>)}
                        {isOwner && <option value="owner">{t('转移所有权')}</option>}
                      </select>
                      {member.userId !== user?.id && (
                        <button type="button" className="icon-btn icon-btn-sm" onClick={() => setRemoveMember(member)} aria-label={t('移除')} title={t('移除')}>
                          <UserMinus size={13} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {canManage && (
            <section className="settings-section">
              <div className="settings-section-head">
                <span className="settings-section-title">{t('邀请成员')}</span>
                <span className="settings-section-desc">{t('会发送邀请邮件，也可复制链接')}</span>
              </div>
              <div className="setting-inline-form">
                <div className="field"><label>{t('邮箱')}</label><input className="input" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="teammate@example.com" /></div>
                <div className="field field-role"><label>{t('角色')}</label><select className="select" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as typeof inviteRole)}>{ROLES.map((role) => <option key={role} value={role}>{roleLabel(t, role)}</option>)}</select></div>
                <button type="button" className="btn btn-primary btn-sm" onClick={invite} disabled={inviting || !inviteEmail.trim()}>
                  {inviting ? <span className="spinner" /> : <MailPlus size={13} />} {t('创建邀请')}
                </button>
              </div>
              {error && <div className="form-error" style={{ marginTop: 10 }}><AlertCircle size={14} /> {error}</div>}
              {inviteLink && (
                <div className="share-link-box" style={{ marginTop: 10 }}>
                  <input readOnly value={inviteLink} onFocus={(event) => event.target.select()} />
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => copy(inviteLink, 'latest')}>{copied === 'latest' ? <Check size={12} /> : <Copy size={12} />} {t('复制')}</button>
                </div>
              )}
              {invitations.length > 0 && (
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {invitations.map((invitation) => (
                    <div key={invitation.id} className="invite-row">
                      <Shield size={13} className="invite-row-icon" />
                      <div className="invite-row-main">
                        <div className="invite-row-title"><span>{invitation.email}</span> <span className="badge">{roleLabel(t, invitation.role)}</span></div>
                        <div className="invite-row-meta">{t('待接受')} · {formatRelativeShort(invitation.createdAt)}</div>
                      </div>
                      <div className="invite-row-actions">
                        {invitation.url && <button type="button" className="icon-btn icon-btn-sm" onClick={() => copy(invitation.url!, invitation.id)} aria-label={t('复制邀请链接')}>{copied === invitation.id ? <Check size={12} /> : <Copy size={12} />}</button>}
                        <button type="button" className="icon-btn icon-btn-sm" onClick={() => void revokeInvitation(invitation.id)} aria-label={t('撤销')}><Trash2 size={12} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {canManage && (
            <section className="settings-section">
              <div className="settings-section-head">
                <span className="settings-section-title">{t('审计日志')}</span>
                <span className="settings-section-desc">{t('重要安全与数据操作')}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {audit.length === 0 ? (
                  <div className="context-empty">{t('暂无记录')}</div>
                ) : (
                  audit.slice(0, 20).map((entry) => (
                    <div key={entry.id} className="audit-row">
                      <span className="audit-time">{formatFullDate(entry.createdAt)}</span>
                      <span className="audit-actor">{entry.actorName ?? t('系统')}</span>
                      <span className="audit-action">{auditActionLabel(t, entry.action)}</span>
                      <span className="audit-ip">{entry.ip}</span>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}
        </>
      ))}

      {workspace && (workspace.kind === 'team' || workspaces.length > 1) && (
        <section className="settings-section">
          <div className="settings-section-head"><span className="settings-section-title" style={{ color: 'var(--red)' }}>{t('危险操作')}</span></div>
          {workspace.kind === 'team' && (
            <div className="setting-row">
              <div className="setting-row-main"><div className="setting-row-title">{t('离开空间')}</div><div className="setting-row-desc">{t('离开后，你将失去对空间内容的访问权限。你创建的笔记会保留。')}</div></div>
              <div className="setting-row-control"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setLeaveOpen(true)} disabled={isOwner}><LogOut size={13} /> {t('离开')}</button></div>
            </div>
          )}
          {workspaces.length > 1 && (
            <div className="setting-row">
              <div className="setting-row-main">
                <div className="setting-row-title">{workspace.kind === 'personal' ? t('删除个人空间') : t('删除空间')}</div>
                <div className="setting-row-desc">{workspace.kind === 'personal' ? t('个人空间中的笔记、附件会被删除。删除后仍会保留其他空间。') : t('空间及其中的笔记、附件会被删除。此操作需要先下载备份。')}</div>
              </div>
              <div className="setting-row-control"><button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => setDeleteOpen(true)}><Trash2 size={13} /> {t('删除空间')}</button></div>
            </div>
          )}
        </section>
      )}

      <Modal
        open={createOpen}
        onClose={closeCreate}
        title={t('创建空间')}
        description={t('个人空间只有你可见；团队空间用于多人协作；加密空间使用独立密码派生密钥。创建后可以随时切换。')}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={closeCreate}>{t('取消')}</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={createWorkspace} disabled={creating || !createName.trim() || (createKind === 'vault' && (vaultPassword.length < 10 || vaultPassword !== vaultPasswordConfirm))}>
              {creating ? <span className="spinner" /> : createKind === 'personal' ? <UserRound size={13} /> : createKind === 'vault' ? <UserLock size={13} /> : <UsersRound size={13} />}
              {createKind === 'personal' ? t('创建个人空间') : createKind === 'vault' ? t('创建加密空间') : t('创建团队空间')}
            </button>
          </>
        }
      >
        <div className="share-permission-list" style={{ marginBottom: 16 }}>
          {([
            { value: 'personal' as const, icon: <UserRound size={15} />, name: t('个人空间'), desc: t('只有你可见的私有空间，可重命名。') },
            { value: 'team' as const, icon: <UsersRound size={15} />, name: t('团队空间'), desc: t('可邀请成员、分配角色并查看审计。') },
            { value: 'vault' as const, icon: <UserLock size={15} />, name: t('加密空间'), desc: t('独立密码派生密钥；不可分享、评论、双链或导出。') },
          ]).map((option) => (
            <button
              key={option.value}
              type="button"
              className={`share-permission-option ${createKind === option.value ? 'selected' : ''}`}
              onClick={() => {
                setCreateKind(option.value);
                setCreateIcon(option.value === 'team' ? '👥' : option.value === 'vault' ? '🔒' : '📔');
              }}
            >
              <span className="share-permission-radio" />
              <span style={{ color: 'var(--text-tertiary)', marginTop: 1 }}>{option.icon}</span>
              <span>
                <span className="share-permission-name">{option.name}</span>
                <span className="share-permission-desc">{option.desc}</span>
              </span>
            </button>
          ))}
        </div>
        <IdentityPicker icon={createIcon} color={createColor} onIcon={setCreateIcon} onColor={setCreateColor} />
        <div className="field" style={{ marginTop: 14 }}>
          <label>{createKind === 'personal' ? t('个人空间名称') : createKind === 'vault' ? t('加密空间名称') : t('团队空间名称')}</label>
          <input
            className="input"
            value={createName}
            onChange={(event) => setCreateName(event.target.value)}
            placeholder={createKind === 'personal' ? t('例如：阅读与写作') : createKind === 'vault' ? t('例如：私人日记') : t('例如：产品团队')}
            maxLength={80}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void createWorkspace();
              }
            }}
          />
          <span className="field-hint">
            {createKind === 'personal' ? t('只有你可以访问；之后也可以创建更多个人或团队空间。') : createKind === 'vault' ? t('只有你可以访问；忘记密码和恢复密钥后内容无法恢复。') : t('你将成为空间所有者，之后可以邀请成员。')}
          </span>
        </div>
        {createKind === 'vault' && (
          <>
            <div className="field" style={{ marginTop: 14 }}>
              <label htmlFor="create-vault-password">{t('空间密码')}</label>
              <input id="create-vault-password" className="input" type="password" value={vaultPassword} onChange={(event) => setVaultPassword(event.target.value)} autoComplete="new-password" minLength={10} />
              <span className="field-hint">{t('至少 10 个字符；不能与账号密码相同。创建后会生成一次性恢复密钥。')}</span>
            </div>
            <div className="field" style={{ marginTop: 14 }}>
              <label htmlFor="create-vault-confirm">{t('确认空间密码')}</label>
              <input id="create-vault-confirm" className="input" type="password" value={vaultPasswordConfirm} onChange={(event) => setVaultPasswordConfirm(event.target.value)} autoComplete="new-password" />
            </div>
            <div className="banner banner-warning" style={{ marginTop: 14 }}>
              <ShieldAlert size={15} />
              <div>{t('空间密码和恢复密钥都无法由服务器找回。请把恢复密钥保存在密码管理器或离线位置。')}</div>
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={Boolean(removeMember)}
        onClose={() => setRemoveMember(null)}
        title={t('移除成员？')}
        description={t('成员将立即失去访问权限。')}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRemoveMember(null)}>{t('取消')}</button>
            <button type="button" className="btn btn-danger btn-sm" onClick={confirmRemove}>{t('移除')}</button>
          </>
        }
      >
        <p style={{ fontSize: 13 }}>{removeMember?.displayName} · {removeMember?.email}</p>
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t('删除空间？')}
        description={t('此操作会删除空间及其内容。请确保已经下载备份。')}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDeleteOpen(false)}>{t('取消')}</button>
            <button type="button" className="btn btn-danger btn-sm" onClick={deleteWorkspace}><Trash2 size={13} /> {t('删除空间')}</button>
          </>
        }
      >
        <p style={{ fontSize: 13 }}>{workspace?.name}</p>
      </Modal>

      <Modal
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        title={t('离开空间？')}
        description={t('你将失去访问权限，但不会删除其他成员的内容。')}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLeaveOpen(false)}>{t('取消')}</button>
            <button type="button" className="btn btn-danger btn-sm" onClick={leaveWorkspace}>{t('离开')}</button>
          </>
        }
      >
        <p style={{ fontSize: 13 }}>{workspace?.name}</p>
      </Modal>

      <ConfirmDialog
        open={Boolean(ownerTarget)}
        onClose={() => setOwnerTarget(null)}
        onConfirm={() => {
          const member = ownerTarget;
          setOwnerTarget(null);
          if (member) void applyRole(member, 'owner');
        }}
        title={t('转移空间所有权')}
        description={ownerTarget ? t('确定把空间所有权转移给 {name}？你将成为管理员。', { name: ownerTarget.displayName }) : undefined}
        confirmLabel={t('转移所有权')}
        danger
      />

      <Modal
        open={vaultPasswordOpen}
        onClose={() => setVaultPasswordOpen(false)}
        title={t('修改空间密码')}
        description={t('修改后其他设备会立即锁定，正文和附件仍使用同一数据密钥。')}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setVaultPasswordOpen(false)}>{t('取消')}</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void changeVaultPassword()} disabled={vaultBusy || !vaultCurrentPassword || vaultNewPassword.length < 10 || vaultNewPassword !== vaultNewPasswordConfirm}>
              {vaultBusy ? <span className="spinner" /> : <KeyRound size={13} />} {t('更新密码')}
            </button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="vault-current-password">{t('当前空间密码')}</label>
          <input id="vault-current-password" className="input" type="password" value={vaultCurrentPassword} onChange={(event) => setVaultCurrentPassword(event.target.value)} autoComplete="current-password" />
        </div>
        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="vault-next-password">{t('新的空间密码')}</label>
          <input id="vault-next-password" className="input" type="password" value={vaultNewPassword} onChange={(event) => setVaultNewPassword(event.target.value)} autoComplete="new-password" />
          <span className="field-hint">{t('至少 10 个字符。')}</span>
        </div>
        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="vault-next-confirm">{t('确认新密码')}</label>
          <input id="vault-next-confirm" className="input" type="password" value={vaultNewPasswordConfirm} onChange={(event) => setVaultNewPasswordConfirm(event.target.value)} autoComplete="new-password" />
        </div>
        {vaultNewPassword && vaultNewPassword !== vaultNewPasswordConfirm && <div className="form-error" style={{ marginTop: 10 }}>{t('两次输入的密码不一致')}</div>}
      </Modal>

      <Modal
        open={vaultRecoveryOpen}
        onClose={() => setVaultRecoveryOpen(false)}
        title={t('重新生成恢复密钥')}
        description={t('需要验证当前空间密码。旧恢复密钥会立即失效。')}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setVaultRecoveryOpen(false)}>{t('取消')}</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void regenerateVaultRecovery()} disabled={vaultBusy || !vaultRecoveryPassword}>
              {vaultBusy ? <span className="spinner" /> : <KeyRound size={13} />} {t('生成新密钥')}
            </button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="vault-recovery-password">{t('当前空间密码')}</label>
          <input id="vault-recovery-password" className="input" type="password" value={vaultRecoveryPassword} onChange={(event) => setVaultRecoveryPassword(event.target.value)} autoComplete="current-password" />
        </div>
      </Modal>

      <Modal
        open={Boolean(recoveryDialog)}
        onClose={() => { setRecoveryDialog(null); if (recoveryAfterCreate) navigate('/app'); }}
        title={t('保存恢复密钥')}
        description={t('这是唯一一次显示。忘记空间密码时，它是恢复内容的唯一方式。')}
        size="sm"
        footer={
          <button type="button" className="btn btn-primary btn-sm" onClick={() => { setRecoveryDialog(null); if (recoveryAfterCreate) navigate('/app'); }}>
            <Check size={13} /> {t('我已保存')}
          </button>
        }
      >
        {recoveryDialog && (
          <>
            <div className="vault-recovery-key">
              <code>{recoveryDialog}</code>
              <button type="button" className="icon-btn icon-btn-sm" onClick={() => copy(recoveryDialog, 'vault-recovery')} aria-label={t('复制恢复密钥')} title={t('复制恢复密钥')}>
                {copied === 'vault-recovery' ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
            <div className="banner banner-warning" style={{ marginTop: 14 }}>
              <ShieldAlert size={15} />
              <div>{t('恢复密钥和空间密码都无法由 360note 找回。两者都丢失时，加密空间的内容无法恢复。')}</div>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

const WORKSPACE_ICONS = ['📔', '📚', '💡', '🧭', '🌿', '🚀', '🎯', '🗂️', '👥', '🧪', '🏠', '✍️'];
const WORKSPACE_COLORS = ['#17865b', '#0f766e', '#4d7c0f', '#b45309', '#be123c', '#7c3aed', '#0e7490', '#475569'];

function IdentityPicker({
  icon,
  color,
  onIcon,
  onColor,
}: {
  icon: string;
  color: string;
  onIcon: (value: string) => void;
  onColor: (value: string) => void;
}) {
  const t = useT();
  return (
    <div className="identity-picker">
      <div>
        <div className="setting-note" style={{ marginBottom: 6 }}>{t('图标')}</div>
        <div className="identity-options">
          {WORKSPACE_ICONS.map((symbol) => (
            <button
              key={symbol}
              type="button"
              className={`identity-symbol ${icon === symbol ? 'selected' : ''}`}
              onClick={() => onIcon(symbol)}
              aria-label={symbol}
            >
              {symbol}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="setting-note" style={{ marginBottom: 6 }}>{t('背景颜色')}</div>
        <div className="identity-options">
          {WORKSPACE_COLORS.map((entry) => (
            <button
              key={entry}
              type="button"
              className={`identity-color ${color.toLowerCase() === entry.toLowerCase() ? 'selected' : ''}`}
              style={{ background: entry }}
              onClick={() => onColor(entry)}
              aria-label={entry}
            />
          ))}
          <input
            type="color"
            value={color}
            onChange={(event) => onColor(event.target.value)}
            aria-label={t('自定义颜色')}
            className="identity-color-input"
          />
        </div>
      </div>
    </div>
  );
}

function roleLabel(t: ReturnType<typeof useT>, role: string): string {
  if (role === 'owner') return t('所有者');
  if (role === 'admin') return t('管理员');
  if (role === 'editor') return t('编辑者');
  if (role === 'viewer') return t('查看者');
  return role;
}


