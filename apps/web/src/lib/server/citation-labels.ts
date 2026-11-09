import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import {unified} from 'unified';
import {remarkCitations} from '../stream';

const markdown = unified().use(remarkParse).use(remarkGfm);

export function citationLabels(text: string): number[] {
  const labels: number[] = [];
  try {
    remarkCitations({onCitation: label => labels.push(label)})(markdown.parse(text));
  } catch {
    // Optional citation annotations must not interrupt delivery of model text.
    return [];
  }
  return labels;
}
