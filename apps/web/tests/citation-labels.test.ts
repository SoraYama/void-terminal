import {expect, it} from 'vitest';
import {citationLabels} from '../src/lib/server/citation-labels';

it('uses the same citation marks as the rendered Markdown', () => {
  const text = [
    'Source [2] and **source ［3］**. Literal `[1]` and link [4](https://example.com).',
    '[5]\n\n[5]: https://example.com',
    '```text\n[6]\n```',
  ].join('\n\n');
  expect(citationLabels(text)).toEqual([2, 3]);
});
