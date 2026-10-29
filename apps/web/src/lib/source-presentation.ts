import type {ContentType, Locale} from './contracts';

/** Plain-text display only. Never changes stored evidence, offsets or citations. */
export function readableGameText(value: string, locale: Locale = 'zh-CN'): string {
  return value
    .replace(/\\r\\n|\\n/g, '\n').replace(/\r\n?/g, '\n')
    .replace(/#(?=<\/?(?:color|size)\b)/gi, '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<image\s[^<>]*\/?\s*>/gi, locale === 'zh-CN' ? '[图片]' : '[Image]')
    .replace(/<\/?(?:color|size|b|i|u)(?:=[^<>]*|\s[^<>]*)?>/gi, '')
    .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&amp;/gi, '&')
    .trim();
}

function shortened(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length <= max ? value : chars.slice(0, max).join('').trimEnd() + '…';
}

interface DisplaySource {title: string; type: ContentType; excerpt?: string; text?: string; metadata?: Record<string, unknown>}
export function presentSource(source: DisplaySource, locale: Locale) {
  const fileTitle = source.metadata?.titleUnresolved === true ||
    /^(?:book\s+)?(?:Book|Document|Weapon)[:_-]?\d+(?:[_-]\d+)*$/i.test(source.title.trim());
  const passage = source.excerpt ?? source.text ?? '';
  const clean = readableGameText(fileTitle ? passage : source.title, locale);
  const compact = clean.replace(/\s+/g, ' ');
  const derived = fileTitle || source.metadata?.kind === 'orphan_textmap' || compact.length > 90 || /\n|\\n/.test(source.title);
  const firstLine = clean.split('\n').find(line => line.trim())?.trim() ?? '';
  const bracketHeading = firstLine.match(/^[【「《]([^】」》]{2,40})[】」》]/)?.[1];
  const fallback = locale === 'zh-CN' ? '未命名原文' : 'Untitled source';
  const imageOnly = fileTitle && /^\[(?:图片|Image)\]$/.test(compact);
  const title = imageOnly ? (locale === 'zh-CN' ? '未题名图像记录' : 'Untitled image record') : derived
    ? bracketHeading ?? shortened(firstLine.split(/(?<=[。！？.!?])\s*/u)[0] || compact || fallback, 48)
    : compact || fallback;
  const excerpt = readableGameText(passage, locale).replace(/\s+/g, ' ');
  return {
    title,
    excerpt: shortened(excerpt, 180),
    derived,
    note: imageOnly || (fileTitle && !compact) ? (locale === 'zh-CN' ? '未标注正式标题' : 'No title supplied') : derived ? (locale === 'zh-CN' ? '标题摘自原文' : 'Title taken from the passage') : null,
    unlinked: source.metadata?.contextUnknown === true,
  };
}
