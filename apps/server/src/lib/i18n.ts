/**
 * Server-side message localisation.
 *
 * The application was written Chinese-first. Rather than rewriting every route,
 * we keep the Chinese source strings and translate the user-facing messages at
 * the HTTP boundary based on the request's Accept-Language header.
 */
const en: Record<string, string> = {
  '请先登录': 'Please sign in first',
  '没有权限执行此操作': 'You do not have permission to do this',
  '未找到': 'Not found',
  '请求无效': 'Invalid request',
  '内容已在其他位置更新': 'This content was updated elsewhere',
  '操作过于频繁，请稍后再试': 'Too many requests. Please try again later.',
  '文件过大': 'The file is too large',
  '服务器内部错误': 'Internal server error',
  '请求参数无效': 'Invalid request parameters',
  '缺少安全请求头': 'Missing security request header',
  '接口不存在': 'API endpoint not found',
  '上传内容过大': 'The upload is too large',
  '请求过于频繁，请稍后再试': 'Too many requests. Please try again later.',
  '请输入有效的邮箱地址': 'Please enter a valid email address',
  '密码至少需要 10 个字符': 'The password must be at least 10 characters',
  '密码不能全是数字': 'The password cannot be all digits',
  '密码不能包含邮箱地址': 'The password cannot contain your email address',
  '密码不能超过 200 个字符': 'The password cannot exceed 200 characters',
  '没有编辑权限': 'You do not have permission to edit',
  '无效的 ID': 'Invalid ID',
  '标题过长': 'The title is too long',
  '单篇笔记不能超过 2,000,000 个字符': 'A note cannot exceed 2,000,000 characters',
  '请输入 6 位邮箱验证码': 'Enter the 6-digit email verification code',
  '验证码不正确': 'The verification code is incorrect',
  '验证码不正确或已使用': 'The verification code is incorrect or already used',
  '验证码不正确或已过期': 'The verification code is incorrect or has expired',
  '验证码发送过于频繁，请稍后再试': 'Please wait a moment before requesting another code',
  '验证码发送次数过多，请稍后再试': 'Too many codes requested. Please try again later.',
  '邮件服务尚未配置，暂时无法发送验证码': 'Email delivery is not configured, so a code cannot be sent right now',
  '密码不正确': 'The password is incorrect',
  '当前密码不正确': 'The current password is incorrect',
  '邮箱或密码不正确': 'Incorrect email or password',
  '邮箱或恢复密钥不正确': 'Incorrect email or recovery key',
  '两次输入的密码不一致': 'The two passwords do not match',
  '这个邮箱已注册': 'This email is already registered',
  '这是你当前使用的邮箱': 'This is already your current email address',
  '新邮箱与当前邮箱相同': 'The new email is the same as your current email',
  '当前仅接受邀请注册': 'This instance currently accepts invitation-only registration',
  '登录尝试过多，请稍后再试': 'Too many sign-in attempts. Please try again later.',
  '验证已过期，请重新登录': 'Verification expired. Please sign in again.',
  '两步验证已开启': 'Two-factor authentication is already enabled',
  '两步验证未开启': 'Two-factor authentication is not enabled',
  '请先开始设置两步验证': 'Start setting up two-factor authentication first',
  '需要实例管理员权限': 'Instance administrator permission is required',
  '会话不存在': 'Session not found',
  '令牌不存在': 'Token not found',
  '此 API 令牌没有所需权限': 'This API token does not have the required scope',
  '此 API 令牌无权访问该接口': 'This API token cannot access this endpoint',
  '工作区不存在': 'Workspace not found',
  '工作区不存在或无权访问': 'Workspace not found or access denied',
  '工作区没有可用的所有者': 'The workspace has no available owner',
  '缺少工作区': 'Workspace is required',
  '至少保留一个空间': 'At least one workspace must remain',
  '个人空间是私密的，不能邀请成员': 'Personal spaces are private and cannot have members',
  '该用户已经是空间成员': 'This user is already a workspace member',
  '成员不存在': 'Member not found',
  '不能移除空间所有者': 'The workspace owner cannot be removed',
  '不能移除自己，请使用“离开空间”': 'You cannot remove yourself here. Use “Leave workspace” instead.',
  '只有所有者可以邀请管理员': 'Only the owner can invite administrators',
  '只有所有者可以转移所有权': 'Only the owner can transfer ownership',
  '请先转移所有权，不能直接移除所有者': 'Transfer ownership first; the owner cannot be removed directly',
  '所有者需要先转移所有权': 'The owner must transfer ownership first',
  '你仍是团队空间的所有者，请先转移所有权或删除空间后再注销账号': 'You still own a team workspace. Transfer ownership or delete the workspace before deleting your account.',
  '已经向这个邮箱发送过邀请': 'An invitation was already sent to this email',
  '这个邀请属于另一个账号': 'This invitation belongs to another account',
  '邀请不存在或已失效': 'The invitation does not exist or is no longer valid',
  '邀请已过期': 'The invitation has expired',
  '笔记不存在': 'Note not found',
  '这篇笔记已在其他设备更新': 'This note was updated on another device',
  '请先恢复这篇笔记': 'Restore this note first',
  '请先恢复这篇笔记再创建分享': 'Restore this note before sharing it',
  '没有分享权限': 'You do not have permission to share this note',
  '端到端加密笔记不能创建公开分享': 'End-to-end encrypted notes cannot be shared publicly',
  '加密笔记不能使用 AI 摘要': 'AI summaries are unavailable for encrypted notes',
  '分享不存在': 'Share not found',
  '分享链接不存在或已失效': 'The share link does not exist or has expired',
  '此分享需要密码': 'This share requires a password',
  '此分享不可评论': 'This share does not allow comments',
  '此分享不可编辑': 'This share does not allow editing',
  '过期时间必须晚于现在': 'The expiry time must be in the future',
  '文件夹不存在': 'Folder not found',
  '父文件夹不存在': 'Parent folder not found',
  '目标文件夹不存在': 'Target folder not found',
  '文件夹不能移动到自身': 'A folder cannot be moved into itself',
  '文件夹不能移动到自己的子文件夹': 'A folder cannot be moved into one of its own subfolders',
  '缺少文件夹': 'Folder is required',
  '标签不存在': 'Tag not found',
  '缺少标签': 'Tag is required',
  '评论不存在': 'Comment not found',
  '只能编辑自己的评论': 'You can only edit your own comments',
  '只能删除自己的评论': 'You can only delete your own comments',
  '附件不存在': 'Attachment not found',
  '没有上传文件': 'No file was uploaded',
  '文件为空': 'The file is empty',
  '版本不存在': 'Version not found',
  '任务不存在': 'Job not found',
  '导入任务不存在': 'Import job not found',
  '导入任务缺少工作区': 'The import job has no workspace',
  '导入内容尚未准备好': 'The import content is not ready yet',
  '导入暂存文件已过期，请重新上传': 'The uploaded import file has expired. Please upload it again.',
  '没有可导入的文件': 'There are no files to import',
  '没有找到可导入的笔记': 'No importable notes were found',
  '请选择要导入的文件': 'Choose a file to import',
  '一次导入不能超过 250 MB': 'A single import cannot exceed 250 MB',
  '暂不支持这种文件格式。请上传 Markdown、HTML、ENEX、CSV、JSON 或 ZIP': 'This file format is not supported. Upload Markdown, HTML, ENEX, CSV, JSON or ZIP.',
  '无法解析 Evernote 文件': 'Could not parse the Evernote file',
  '无法识别的 JSON 导出格式': 'Unrecognised JSON export format',
  '压缩包内文件过多': 'The archive contains too many files',
  '压缩包包含不安全的路径': 'The archive contains an unsafe path',
  '压缩包压缩比异常': 'The archive has an abnormal compression ratio',
  '解压后的文件过大': 'The extracted files are too large',
  '这是完整备份文件，请在“备份与恢复”中恢复，而不是导入': 'This is a full backup. Restore it from “Data & backup”, not from Import.',
  '备份不存在': 'Backup not found',
  '上传的备份不存在': 'The uploaded backup was not found',
  '请选择备份文件': 'Choose a backup file',
  '备份文件不能超过 600 MB': 'A backup file cannot exceed 600 MB',
  '备份文件内容无法解析': 'The backup contents could not be parsed',
  '备份文件已损坏': 'The backup file is damaged',
  '备份文件包含过多条目': 'The backup contains too many entries',
  '备份文件中的单个文件过大': 'A file inside the backup is too large',
  '备份文件解压后过大': 'The extracted backup is too large',
  '备份文件压缩比异常': 'The backup has an abnormal compression ratio',
  '备份格式不受支持': 'The backup format is not supported',
  '不是有效的 360note 备份文件': 'This is not a valid 360note backup',
  '只能替换恢复到备份来源的工作区': 'A replace restore must target the backup’s original workspace',
  '启用异地备份需要填写 endpoint、bucket、accessKeyId': 'Offsite backup requires endpoint, bucket and accessKeyId',
  '开启 AI 前需要填写接口地址和模型名称': 'Enter the endpoint and model name before enabling AI',
  '未知的恢复方式': 'Unknown recovery method',
  "下载链接不存在或已过期": "The download link does not exist or has expired",
  "不支持加密的备份 ZIP": "Encrypted backup ZIP files are not supported",
  "不是有效的 360note 整站备份": "This is not a valid 360note instance backup",
  "不能停用自己的管理员账户": "You cannot disable your own administrator account",
  "不能移除自己的管理员权限": "You cannot remove your own administrator permission",
  "分享功能已被管理员停用": "Sharing has been disabled by an administrator",
  "单个导入文件不能超过 120 MB": "A single import file cannot exceed 120 MB",
  "只能删除自己的评论；笔记作者可以删除匿名访客评论": "You can only delete your own comments; note authors may delete anonymous guest comments",
  "只能在这里恢复工作区备份对象；整站备份请按运维手册恢复数据库": "Only workspace backup objects can be restored here; restore instance backups with the operations runbook",
  "图片尺寸过大，请压缩后再上传": "The image dimensions are too large. Compress it before uploading.",
  "备份包含循环文件夹": "The backup contains a circular folder structure",
  "备份包含重名标签": "The backup contains duplicate tag names",
  "备份包含重复的文件夹 ID": "The backup contains duplicate folder IDs",
  "备份包含重复的标签 ID": "The backup contains duplicate tag IDs",
  "备份包含重复的笔记 ID": "The backup contains duplicate note IDs",
  "备份对象无法解密或不是有效的归档": "The backup object cannot be decrypted or is not a valid archive",
  "备份归档不能通过实例对象存储浏览下载；请由备份所属空间在数据与备份中操作": "Backup archives cannot be downloaded from instance object storage. Use Data & backup in the owning workspace.",
  "备份所属工作区已不存在": "The workspace that owns this backup no longer exists",
  "备份文件包含不安全路径": "The backup contains an unsafe path",
  "备份文件包含重复条目": "The backup contains duplicate entries",
  "备份文件夹父级不属于同一工作区": "A backup folder parent belongs to another workspace",
  "备份标签关联无效": "The backup has an invalid tag association",
  "备份版本关联了其他工作区的笔记": "A backup version belongs to another workspace’s note",
  "备份笔记的文件夹不属于同一工作区": "A backup note belongs to a folder in another workspace",
  "备份评论关联了其他工作区的笔记": "A backup comment belongs to another workspace’s note",
  "备份附件关联了其他工作区的笔记": "A backup attachment belongs to another workspace’s note",
  "实例备份不存在": "Instance backup not found",
  "实例尚未初始化，请使用管理员邮箱完成首次注册": "This instance is not initialized yet. Register with the administrator email first.",
  "实例至少需要保留一个管理员": "The instance must keep at least one administrator",
  "对象存储配置不完整，无法取回附件": "Object storage is not fully configured, so the attachment cannot be retrieved",
  "对象存储附件已经启用": "Object storage for attachments is already enabled",
  "对象键无效": "Invalid object key",
  "工作区没有可用的所有者，无法恢复": "The workspace has no available owner, so it cannot be restored",
  "已有远程附件。更换 Endpoint、Bucket 或 Prefix 前，请先取回本机附件或完成迁移。": "Remote attachments already exist. Retrieve them locally or finish migration before changing endpoint, bucket or prefix.",
  "已有附件保存在对象存储中。请先停用并取回全部附件，再修改连接配置。": "Attachments are stored in object storage. Disable it and retrieve all attachments before changing the connection.",
  "当前账户邮箱为保留测试域名，无法发送导出链接": "The account email uses a reserved test domain, so an export link cannot be sent",
  "整站备份清单无法解析": "The instance backup manifest could not be parsed",
  "未知的备份格式": "Unknown backup format",
  "模板不存在": "Template not found",
  "此网络暂不允许注册新账户": "This network is not currently allowed to create new accounts",
  "没有可导出的自有空间": "There is no owned workspace to export",
  "用户不存在": "User not found",
  "设备不存在": "Device not found",
  "请先保存完整的对象存储连接配置": "Save the complete object storage connection first",
  "请先将文件夹移到回收站，再永久删除": "Move the folder to trash before deleting it permanently",
  "请先将笔记移到回收站，再永久删除": "Move the note to trash before deleting it permanently",
  "请先撤销分享再删除记录": "Revoke the share before deleting its record",
  "请在账户安全页退出自己的其他设备": "Use Account security to sign out your own other devices",
  "账户已被管理员停用，请联系 contact@360note.com": "This account was disabled by an administrator. Contact contact@360note.com.",
  "这里只能删除公开访客评论": "Only public guest comments can be deleted here",
  "附件迁移正在进行，暂不能修改对象存储连接": "Attachment migration is running; the object storage connection cannot be changed yet",
  "附件迁移正在进行，请稍候": "Attachment migration is running. Please wait.",
};

const dynamic: Array<[RegExp, string]> = [
  [/^此 API 令牌缺少 (.+) 权限$/, 'This API token is missing the $1 scope'],
  [/^(.+): (.+)$/, ''],
];

function translateExact(message: string): string | null {
  return en[message] ?? null;
}

export function localizeMessage(message: string, language: string): string {
  if (!language.toLowerCase().startsWith('en')) return message;
  const exact = translateExact(message);
  if (exact) return exact;

  if (message.startsWith('文件不能超过 ')) return message.replace('文件不能超过', 'The file cannot exceed');
  if (message.startsWith('上传失败：')) return `Upload failed: ${message.slice(5)}`;

  for (const [pattern, replacement] of dynamic) {
    const match = message.match(pattern);
    if (match) {
      if (pattern.source === '^(.+): (.+)$') {
        const head = match[1];
        const tail = en[match[2]] ?? match[2];
        return `${head}: ${tail}`;
      }
      return replacement.replace('$1', match[1]);
    }
  }

  // Localise known fragments inside messages with interpolated values.
  const entries = Object.entries(en).sort((a, b) => b[0].length - a[0].length);
  for (const [zh, english] of entries) {
    if (message.includes(zh)) return message.replace(zh, english);
  }
  return message;
}

export function requestLanguage(headers: Record<string, unknown>): string {
  const explicit = headers['x-locale'];
  if (typeof explicit === 'string' && explicit) return explicit;
  const accept = headers['accept-language'];
  return typeof accept === 'string' ? accept : '';
}
