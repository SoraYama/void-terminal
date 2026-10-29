'use client';

import {useState} from 'react';
import {ArrowRight, BookOpen, FileText} from '@phosphor-icons/react';
import type {DocumentResult, DocumentSummary, Locale} from '../lib/contracts';
import {typeNames} from '../lib/i18n';
import {safeUrl} from '../lib/client';
import {presentSource, readableGameText} from '../lib/source-presentation';
import {ContextWarning} from './context-warning';
import {RecordRelations} from './record-relations';
import {Ornament} from './ui';

export function LibraryCard({item, locale, onOpen}: {
  item: DocumentSummary; locale: Locale; onOpen: () => void;
}) {
  const zh = locale === 'zh-CN';
  const display = presentSource(item, locale);
  return <button className="document-card" data-document-id={item.id} onClick={onOpen}>
    <span className="document-type"><BookOpen size={18}/>{zh ? typeNames[item.type] : item.type}
      {display.unlinked && <span className="record-badge">{zh ? '未归属文本' : 'Unlinked text'}</span>}
    </span>
    <h2>{display.title}</h2>
    {display.note && <span className="derived-title-note">{display.note}</span>}
    <p>{display.excerpt || (zh ? '打开阅读这份记录。' : 'Open this record to read it.')}</p>
    <span className="read-link">{zh ? '阅读全文' : 'Read the passage'}<ArrowRight size={18}/></span>
  </button>;
}

export function LibraryReader({record, locale, onSelection, onOpen}: {
  record: DocumentResult; locale: Locale; onSelection: (text: string) => void;
  onOpen: (id: string, snapshotId?: string) => Promise<void>;
}) {
  const [raw, setRaw] = useState(false);
  const zh = locale === 'zh-CN';
  const doc = record.document;
  const display = presentSource(doc, locale);
  const paragraphs = readableGameText(doc.text, locale).split('\n').filter(p => p.trim());
  function selectPassage() {
    const selection = window.getSelection();
    if (!selection || !selection.toString().trim()) return;
    // Ignore selections outside this passage.
    if (selection.anchorNode?.parentElement?.closest('.reading-text')) onSelection(selection.toString().slice(0, 6000));
  }
  return <>
    <div className="reading-heading">
      <span className="eyebrow">{zh ? typeNames[doc.type] : doc.type} · {doc.language === 'zh-CN' ? (zh ? '中文原文' : 'Chinese source') : (zh ? '英文原文' : 'English source')}</span>
      <h2>{display.title}</h2>
      {display.note && <p className="derived-title-note">{display.note}</p>}
    </div>
    <Ornament/>
    <ContextWarning metadata={doc.metadata} locale={locale}/>
    <div className="reading-view-switch" role="group" aria-label={zh ? '文本显示方式' : 'Text display'}>
      <button aria-pressed={!raw} onClick={() => setRaw(false)}>{zh ? '阅读排版' : 'Reading view'}</button>
      <button aria-pressed={raw} onClick={() => setRaw(true)}>{zh ? '原始文本' : 'Raw text'}</button>
    </div>
    <article className={'reading-text' + (raw ? ' raw-text' : '')} onMouseUp={selectPassage} onTouchEnd={() => setTimeout(selectPassage, 100)}>
      {raw ? doc.text : paragraphs.map((p, i) => <p key={i}>{p}</p>)}
    </article>
    <RecordRelations document={record} zh={zh} openDocument={onOpen}/>
    <details className="record-provenance">
      <summary><FileText size={16}/>{zh ? '出处与原始记录' : 'Source and original record'}</summary>
      <dl className="metadata">
        <dt>{zh ? '原始标题' : 'Original title'}</dt><dd>{doc.title}</dd>
        <dt>{zh ? '文件' : 'File'}</dt><dd>{doc.source.path}</dd>
        <dt>{zh ? '定位' : 'Location'}</dt><dd>{doc.source.locator}</dd>
        <dt>{zh ? '资料快照' : 'Snapshot'}</dt><dd>{record.snapshotId}</dd>
      </dl>
      {safeUrl(doc.source.url) && <a target="_blank" rel="noopener noreferrer" href={safeUrl(doc.source.url)}>{zh ? '查看上游原文' : 'View upstream source'} ↗</a>}
    </details>
  </>;
}
