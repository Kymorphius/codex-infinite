import fs from 'node:fs/promises';
import path from 'node:path';
import { httpError } from './http-utils.mjs';

export function validateNativeAttachments(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8 || value.some(a => !a || a.kind !== 'image' || typeof a.path !== 'string' || !path.isAbsolute(a.path) || a.path.length > 4096)) throw httpError(400, '图片附件无效，最多发送 8 张图片');
  return value.map(a => ({ kind: 'image', path: a.path }));
}
const rootExpression = `document.querySelector('[data-codex-composer="true"][contenteditable="true"]')?.closest('[data-composer-surface-variant]')`;
export async function stageNativeAttachments(adapter, connection, attachments) {
  const files = [];
  for (const attachment of validateNativeAttachments(attachments)) {
    const handle = await fs.open(attachment.path, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 25 * 1024 * 1024 || !stat.size) throw httpError(400, '图片为空或超过 25 MB');
      const bytes = await handle.readFile();
      const mime = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
        : bytes[0] === 255 && bytes[1] === 216 ? 'image/jpeg'
        : bytes.subarray(0, 3).toString() === 'GIF' ? 'image/gif'
        : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : null;
      if (!mime) throw httpError(400, '仅支持 PNG、JPEG、GIF 和 WebP 图片');
      files.push({ name: path.basename(attachment.path), mime, base64: bytes.toString('base64') });
    } finally { await handle.close(); }
  }
  const safe = await connection.evaluate(`(() => {const root=${rootExpression};return !!root && !root.querySelector('img') && !Array.from(root.querySelectorAll('button[aria-label]')).some(b=>/^(Remove|移除|删除|移除附件)/i.test(b.getAttribute('aria-label')));})()`);
  if (!safe) throw httpError(409, '原生输入框已有附件或状态不可确认，请在原会话处理后再发送。');
  if (!files.length) return;
  const accepted = await connection.evaluate(`(() => {
    const editor=document.querySelector('[data-codex-composer="true"][contenteditable="true"]');if(!editor)return false;
    const data=new DataTransfer();for(const file of ${JSON.stringify(files)}){const bytes=Uint8Array.from(atob(file.base64),c=>c.charCodeAt(0));data.items.add(new File([bytes],file.name,{type:file.mime}));}
    editor.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));return true;
  })()`);
  const ready = accepted && await adapter.waitFor(connection, `(() => {const root=${rootExpression};const images=Array.from(root?.querySelectorAll('img')||[]);return images.length===${files.length}&&images.every(i=>i.complete&&i.naturalWidth>0);})()`);
  if (!ready) throw httpError(503, '无法确认原生图片附件已就绪；请查看原会话草稿，勿重复发送。');
}
