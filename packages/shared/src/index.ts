/**
 * 360note shared contracts.
 * These types are the single source of truth shared by the API and the web client.
 */

export type Role = 'owner' | 'admin' | 'editor' | 'viewer';
export type WorkspaceKind = 'personal' | 'team';
export type SharePermission = 'view' | 'comment' | 'edit';
export type ExportFormat = 'md' | 'html' | 'pdf' | 'json';
export type ThemePreference = 'system' | 'light' | 'dark';
export type NoteSort = 'updated' | 'created' | 'title' | 'opened';
export type NoteFilter = 'all' | 'recent' | 'favorites' | 'trash' | 'folder' | 'tag' | 'shared';

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: 'user' | 'admin';
  avatarColor: string;
  totpEnabled: boolean;
  encryptionEnabled: boolean;
  createdAt: string;
  prefs: UserPrefs;
}

export interface UserPrefs {
  theme?: ThemePreference;
  locale?: 'zh-CN' | 'en';
  editorWidth?: 'narrow' | 'wide';
  spellcheck?: boolean;
  defaultFolderId?: string | null;
  defaultNoteFormat?: 'rich' | 'markdown';
  reduceMotion?: boolean;
  [key: string]: unknown;
}

export interface SessionInfo {
  id: string;
  current: boolean;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  kind: WorkspaceKind;
  icon: string;
  color: string;
  ownerId: string;
  role: Role;
  memberCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMember {
  userId: string;
  email: string;
  displayName: string;
  avatarColor: string;
  role: Role;
  joinedAt: string;
}

export interface Invitation {
  id: string;
  workspaceId: string;
  workspaceName?: string;
  email: string;
  role: Role;
  inviterName?: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
  expiresAt: string;
}

export interface Folder {
  id: string;
  workspaceId: string;
  parentId: string | null;
  name: string;
  color: string | null;
  icon: string | null;
  position: number;
  noteCount?: number;
  trashedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  workspaceId: string;
  name: string;
  color: string | null;
  noteCount?: number;
  createdAt: string;
}

export interface Attachment {
  id: string;
  noteId: string;
  filename: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  ocrStatus: 'none' | 'pending' | 'done' | 'failed';
  createdAt: string;
  url?: string;
}

export interface NoteSummary {
  id: string;
  workspaceId: string;
  folderId: string | null;
  title: string;
  excerpt: string;
  version: number;
  isFavorite: boolean;
  isPinned: boolean;
  encrypted: boolean;
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
  tags: TagRef[];
  attachmentCount?: number;
  snippet?: string | null;
}

export interface TagRef {
  id: string;
  name: string;
  color: string | null;
}

export interface Note extends NoteSummary {
  contentMd: string;
  createdBy: string;
  updatedBy: string;
  folderPath?: FolderPathItem[];
  attachments: Attachment[];
  wordCount?: number;
  canEdit: boolean;
  canShare: boolean;
}

export interface FolderPathItem {
  id: string;
  name: string;
}

export interface NoteVersion {
  id: number;
  noteId: string;
  version: number;
  title: string;
  createdAt: string;
  reason: 'auto' | 'manual' | 'restore' | 'import' | 'conflict';
  authorName?: string;
  preview?: string;
}

export interface NoteVersionDetail extends NoteVersion {
  contentMd: string;
}

export interface Backlink {
  id: string;
  title: string;
  excerpt: string;
  updatedAt: string;
}

export interface ShareLink {
  id: string;
  noteId: string;
  token?: string;
  url?: string;
  permission: SharePermission;
  hasPassword: boolean;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  viewCount: number;
  lastAccessedAt: string | null;
}

export interface Comment {
  id: string;
  noteId: string;
  authorName: string;
  authorId: string | null;
  isGuest: boolean;
  body: string;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublicShare {
  token: string;
  note: {
    id: string;
    title: string;
    contentMd: string;
    updatedAt: string;
    version: number;
    encrypted: boolean;
    attachments: Attachment[];
  };
  permission: SharePermission;
  requiresPassword: boolean;
  hasAccess: boolean;
  workspaceName: string;
  expiresAt: string | null;
  commentsEnabled: boolean;
  comments?: Comment[];
  authorName: string;
  publishedAt: string;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface AuditEntry {
  id: number;
  action: string;
  targetType: string | null;
  targetId: string | null;
  meta: Record<string, unknown> | null;
  actorName: string | null;
  ip: string | null;
  createdAt: string;
}

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface BackupInfo {
  id: string;
  filename: string;
  size: number;
  kind: 'auto' | 'manual' | 'pre-restore';
  status: 'ready' | 'running' | 'failed';
  noteCount: number;
  attachmentCount: number;
  createdAt: string;
  offsite?: 'disabled' | 'uploaded' | 'failed';
}

export interface JobInfo {
  id: string;
  type: string;
  status: 'queued' | 'running' | 'done' | 'error';
  progress: number;
  message: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SearchResponse {
  notes: NoteSummary[];
  attachments: Array<{
    id: string;
    noteId: string;
    noteTitle: string;
    filename: string;
    mime: string;
  }>;
  total: number;
  tookMs: number;
}

export interface ImportPreview {
  jobId: string;
  source: 'markdown' | 'html' | 'enex' | 'notion' | 'csv' | 'unknown';
  noteCount: number;
  attachmentCount: number;
  folders: string[];
  warnings: string[];
  samples: Array<{ title: string; folder: string | null; excerpt: string }>;
}

export interface SearchFilters {
  q?: string;
  workspaceId?: string;
  filter?: NoteFilter;
  folderId?: string;
  tagId?: string;
  sort?: NoteSort;
  limit?: number;
  cursor?: string;
}

export interface SyncConflict {
  code: 'VERSION_CONFLICT';
  current: Note;
  baseVersion: number;
}

export interface HealthResponse {
  ok: boolean;
  version: string;
  time: string;
  database: boolean;
}

export const APP_NAME = '360note';
export const APP_VERSION = '0.1.0';
export const SUPPORTED_LOCALES = ['zh-CN', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const ROLE_RANK: Record<Role, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  owner: 4,
};

export const PERMISSIONS = {
  read: ['viewer', 'editor', 'admin', 'owner'] as Role[],
  write: ['editor', 'admin', 'owner'] as Role[],
  share: ['editor', 'admin', 'owner'] as Role[],
  manage: ['admin', 'owner'] as Role[],
  transfer: ['owner'] as Role[],
};

export function can(role: Role | undefined, action: keyof typeof PERMISSIONS): boolean {
  if (!role) return false;
  return PERMISSIONS[action].includes(role);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
