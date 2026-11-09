export interface AnswerCard {
  kind: 'character' | 'weapon' | 'artifact';
  id: string;
  snapshotId: string;
  citation?: number;
  name: string;
  subtitle: string;
  description: string;
  image: string | null;
  rarity: number | null;
  element?: string | null;
  facts?: { label: string; value: string }[];
}

export function answerCardUrl(card: AnswerCard) {
  const {kind, id, snapshotId} = card;
  if (kind === 'character') {
    return '/characters?' + new URLSearchParams({character: id, snapshotId});
  }
  return '/museum?' + new URLSearchParams({category: kind, item: id, snapshotId});
}
