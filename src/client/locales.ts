import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { RpcError } from './types.js'

export const NS = 'dsh-universal-attachments'

export const zh = {
  'drop.pending': '\u6b63\u5728\u8bfb\u53d6\u62d6\u5165\u7684\u9644\u4ef6',
  'drop.empty': '\u6ca1\u6709\u627e\u5230\u53ef\u8bfb\u53d6\u7684\u6587\u4ef6',
  'attach.title': '添加附件',
  'attach.files': '上传文件',
  'attach.folder': '上传文件夹',
  'attach.filesHint': '任何文件类型',
  'attach.folderHint': '保留目录结构',
  'drop.title': '松开鼠标,上传文件或文件夹',
  'drop.sub': '可拖到页面任意位置,文件会从当前浏览器上传到 DSH 服务器工作区',
  'upload.preparing': '正在准备上传…',
  'upload.progress': '已上传 {percent}%',
  'upload.ready': '已上传',
  'upload.folderMeta': '{count} 个文件 · {size}',
  'upload.fileMeta': '{size}',
  'upload.send': '\u53d1\u9001\u9644\u4ef6',
  'upload.sending': '\u6b63\u5728\u53d1\u9001...',
  'upload.failed': '上传失败:{message}',
  'upload.partial': '「{name}」上传失败:{message}',
  'upload.noApi': '附件服务未就绪,请稍后重试',
  'upload.noSession': '当前没有可用会话',
  'upload.emptyFolder': '文件夹「{name}」为空或浏览器无法读取',
  'upload.remove': '移除 {name}',
  'upload.preview': '预览 {name}',
  'upload.images': '待发送图片',
  'upload.scrollLeft': '\u5411\u5de6\u6eda\u52a8\u9644\u4ef6',
  'upload.scrollRight': '\u5411\u53f3\u6eda\u52a8\u9644\u4ef6',
  'preview.loading': '正在加载预览…',
  'preview.close': '关闭',
  'preview.download': '下载',
  'preview.folder': '文件夹内容',
  'preview.folderTruncated': '仅显示前 {count} 项',
  'preview.textTruncated': '预览已截断',
  'preview.unsupported': '此格式已上传,浏览器不提供内嵌预览。',
  'preview.failed': '预览失败:{message}',
  'history.preview': '点击预览',
  'history.failed': '预览不可用',
  'history.attachments': '已发送附件',
  'error.unknown': '未知错误',
} satisfies Record<string, string>

export type Key = keyof typeof zh

export const en = {
  'drop.pending': 'Reading dropped attachments',
  'drop.empty': 'No readable files were found',
  'attach.title': 'Add attachments',
  'attach.files': 'Upload files',
  'attach.folder': 'Upload folder',
  'attach.filesHint': 'Any file type',
  'attach.folderHint': 'Keep directory structure',
  'drop.title': 'Release to upload files or folders',
  'drop.sub': 'Drop anywhere on the page; files upload from this browser to the DSH server workspace',
  'upload.preparing': 'Preparing upload…',
  'upload.progress': 'Uploaded {percent}%',
  'upload.ready': 'Uploaded',
  'upload.folderMeta': '{count} files · {size}',
  'upload.fileMeta': '{size}',
  'upload.send': 'Send attachments',
  'upload.sending': 'Sending...',
  'upload.failed': 'Upload failed: {message}',
  'upload.partial': 'Failed to upload "{name}": {message}',
  'upload.noApi': 'Attachment service is not ready; try again shortly',
  'upload.noSession': 'No active conversation is available',
  'upload.emptyFolder': 'Folder "{name}" is empty or unreadable by this browser',
  'upload.remove': 'Remove {name}',
  'upload.preview': 'Preview {name}',
  'upload.images': 'Images ready to send',
  'upload.scrollLeft': 'Scroll attachments left',
  'upload.scrollRight': 'Scroll attachments right',
  'preview.loading': 'Loading preview…',
  'preview.close': 'Close',
  'preview.download': 'Download',
  'preview.folder': 'Folder contents',
  'preview.folderTruncated': 'Showing only the first {count} items',
  'preview.textTruncated': 'Preview truncated',
  'preview.unsupported': 'This format is uploaded, but has no in-browser preview.',
  'preview.failed': 'Preview failed: {message}',
  'history.preview': 'Click to preview',
  'history.failed': 'Preview unavailable',
  'history.attachments': 'Sent attachments',
  'error.unknown': 'Unknown error',
} satisfies Record<Key, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-universal-attachments': Key
  }
}

export type LocaleProps = { t?: Translate<Key> }

let bound: Translate | undefined

export function setBoundT(translate: Translate): void {
  bound = translate
}

export function tr(key: string, params?: Record<string, unknown>): string {
  return bound === undefined ? key : bound(key, params)
}

export function rpcText(error: RpcError): string {
  if (error.code !== undefined) {
    const translated = tr(error.code, error.params)
    if (translated !== error.code) return translated
  }
  return error.message || tr('error.unknown')
}
