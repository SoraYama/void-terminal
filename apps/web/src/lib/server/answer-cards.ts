import type {AnswerCard} from '../answer-cards';
import {allowedCharacterImage, readableCharacterText, type CharacterResult} from '../characters';
import type {Citation, Locale} from '../contracts';
import {allowedItemImage, formatStat, type ItemResult} from '../items';
import {knowledge} from './knowledge';
import {expandLoreQuery} from './lore-policy';

type Target = {kind: AnswerCard['kind']; ids: string[]; set?: boolean};
const maxCards = 3;
const maxCandidates = 6;
const artifactId = /^artifact:[A-Za-z0-9_]+:[a-z_]+$/;
const displayText = (value?: string, max = 170) => {
  const text = readableCharacterText(value ?? '').replace(/\s+/g, ' ');
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
};

function target(source: Citation): Target | undefined {
  const key = source.documentId.split(':');
  const [namespace, language, type, table, number] = key;
  if ((namespace !== 'agd' && namespace !== 'gdb') || language !== source.language || type !== source.type) return;
  const numericId = key.length === 5 && /^[0-9]{1,16}$/.test(number);
  const metadata = source.metadata;
  if (type === 'character' || type === 'voice') {
    const avatar = type === 'character' && numericId && (table === 'Avatar' || table === 'characters')
      ? number : (table === 'FetterStory' || table === 'Fetters') ? String(metadata?.avatarId ?? '') : '';
    if (/^[0-9]{1,16}$/.test(avatar)) return {kind:'character', ids:['avatar:' + avatar]};
  }
  if (type === 'weapon' && numericId && (table === 'Weapon' || table === 'weapons')) {
    return {kind:'weapon', ids:['weapon:' + number]};
  }
  const item = metadata?.itemSummary as {id?: unknown} | undefined;
  if (type === 'weapon' && typeof item?.id === 'string' && /^weapon:[0-9]{1,16}$/.test(item.id)) {
    return {kind:'weapon', ids:[item.id]};
  }
  if (type === 'artifact') {
    if (numericId && table === 'artifacts') {
      return {kind:'artifact', ids:['artifact:' + number + ':flower', 'artifact:' + number + ':circlet'], set:true};
    }
    if (typeof item?.id === 'string' && artifactId.test(item.id)) return {kind:'artifact', ids:[item.id]};
  }
}

function namedIn(text: string, name: string) {
  const term = name.trim().normalize('NFKC').toLowerCase();
  if (term.length < 2) return false;
  const content = text.normalize('NFKC').toLowerCase();
  if (/\p{Script=Han}/u.test(term)) return content.includes(term);
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?:^|[^\\p{L}\\p{N}])' + escaped + '(?:$|[^\\p{L}\\p{N}])', 'u').test(content);
}

function shortEnglishName(name: string) {
  // Some localized entries lead with a family name, e.g. Kamisato Ayaka.
  return name.trim().match(/^(?:[A-Za-z][A-Za-z'-]* ){1,2}([A-Za-z][A-Za-z'-]{3,})$/)?.[1].toLowerCase();
}

async function loadCard(target: Target, source: Citation, language: Locale, signal: AbortSignal): Promise<AnswerCard | undefined> {
  const {kind, ids, set} = target;
  const {snapshotId, documentId} = source;
  const params = new URLSearchParams({language, snapshotId});
  const localizedDoc = documentId.replace(':' + source.language + ':', ':' + language + ':');
  const zh = language === 'zh-CN';
  for (const id of ids) {
    try {
      const path = '/v1/' + (kind === 'character' ? 'characters/' : 'items/') + encodeURIComponent(id) + '?' + params;
      const options = {signal, maxBytes: 8_000_000};
      if (kind === 'character') {
        const result = await knowledge<CharacterResult>(path, options);
        const c = result.character;
        if (result.snapshotId !== snapshotId || c.id !== id || c.language !== language
          || c.state !== 'source-record' || !c.documentIds.includes(localizedDoc)) continue;
        return {
          kind, id, snapshotId, name:c.name, subtitle:[c.title, c.elementName, c.weaponName, c.region].filter(Boolean).join(' · '),
          rarity:c.rarity === 4 || c.rarity === 5 ? c.rarity : null, element:c.element,
          description:displayText(c.description),
          image:(c.portrait && allowedCharacterImage(c.portrait)) || allowedCharacterImage(c.icon),
        } satisfies AnswerCard;
      }
      const result = await knowledge<ItemResult>(path, options);
      const item = result.item;
      if (result.snapshotId !== snapshotId || item.id !== id || item.language !== language || item.category !== kind
        || item.state !== 'source-record' || !item.documentIds.includes(localizedDoc)) continue;
      const artifact = item.artifact;
      if (set && !artifact?.setName) continue;
      const levels = item.weapon?.levels ?? [];
      const last = levels.at(-1);
      const facts = kind === 'weapon' ? last?.stats.slice(0, 2).map(stat => ({
        label:stat.label, value:formatStat(stat.value, stat.unit, language),
      })) : artifact?.setEffects.slice(0, 2).map(effect => ({
        label:zh ? `${effect.pieces} 件套` : `${effect.pieces}-piece`, value:displayText(effect.text, 160),
      }));
      return {
        kind, id, snapshotId, name:set ? artifact!.setName : item.name,
        subtitle:(set ? [zh ? '套装' : 'Set', item.name] : [item.subtype, kind === 'weapon' && last
          ? (zh ? `等级 ${last.level}` : `Lv. ${last.level}`) : artifact?.setName]).filter(Boolean).join(' · '),
        rarity:item.rarity, description:set ? '' : displayText(item.description), image:allowedItemImage(item.icon), facts,
      } satisfies AnswerCard;
    } catch {
      // A snapshot may lack this catalog or this representative piece.
      // Cards are optional; a failed lookup must not fail the text answer.
    }
  }
}

/** Enrich only verified, cited subjects. The model never supplies card markup or URLs. */
export async function buildAnswerCards(
  question: string, sources: Citation[], labels: number[], snapshotId: string,
  answerLanguage: Locale, signal: AbortSignal,
): Promise<AnswerCard[]> {
  const query = expandLoreQuery(question);
  const byLabel = new Map(sources.map(source => [source.citation, source]));
  const aliases = new Map<string, Set<string>>();
  const cited = [...new Set(labels)].flatMap(label => {
    const source = byLabel.get(label);
    if (!source || source.snapshotId !== snapshotId) return [];
    const binding = target(source);
    if (!binding) return [];
    const name = typeof source.metadata?.characterName === 'string' ? source.metadata.characterName : source.title;
    const alias = binding.kind === 'character' && source.language === 'en' ? shortEnglishName(name) : undefined;
    if (alias) {
      const identities = aliases.get(alias) ?? new Set();
      identities.add(binding.ids[0]); aliases.set(alias, identities);
    }
    return [{source, binding, name, alias}];
  });
  const candidates = cited.flatMap(({source, binding, name, alias}) => {
    const direct = namedIn(query, name) || binding.ids.some(id => query.includes(id))
      || !!(alias && aliases.get(alias)?.size === 1 && namedIn(query, alias));
    return direct || source.language !== answerLanguage ? [{source, binding, direct}] : [];
  }).sort((a, b) => Number(b.direct) - Number(a.direct));
  const seen = new Set<string>();
  const selected = candidates.filter(({binding}) => {
    if (seen.has(binding.ids[0])) return false;
    seen.add(binding.ids[0]);
    return true;
  }).slice(0, maxCandidates);
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(1500)]);
  const cards = await Promise.all(selected.map(async ({source, binding, direct}) => {
    const sourceCard = await loadCard(binding, source, source.language, deadline);
    if (!sourceCard) return;
    const card = source.language === answerLanguage ? sourceCard
      : await loadCard(binding, source, answerLanguage, deadline) ?? sourceCard;
    if (direct || namedIn(query, card.name)) return {...card,citation:source.citation};
  }));
  const unique = new Map<string, AnswerCard>();
  for (const card of cards) if (card && !unique.has(card.id)) unique.set(card.id, card);
  return [...unique.values()].slice(0, maxCards);
}
