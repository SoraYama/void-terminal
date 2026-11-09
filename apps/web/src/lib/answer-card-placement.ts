import type {AnswerCard} from './answer-cards';
import type {MarkdownNode} from './stream';

const prose = new Set(['paragraph','list','blockquote','table']);

function visibleText(node:MarkdownNode):string {
 return node.type==='text'?node.value??'':(node.children??[]).map(visibleText).join('');
}
function hasCitation(node:MarkdownNode,label:number):boolean {
 return node.data?.citationLabel===label||!!node.children?.some(child=>hasCitation(child,label));
}

/** Insert trusted card slots at the relevant prose, without rewriting answer text. */
export function remarkAnswerCards({cards}:{cards:AnswerCard[]}){
 return (tree:MarkdownNode)=>{
  const blocks=tree.children;
  if(!blocks?.length||!cards.length)return;
  const placements=new Map<number,number[]>();
  const firstProse=blocks.findIndex(block=>prose.has(block.type));
  const lastHeading=blocks.findLastIndex(block=>block.type==='heading');
  cards.forEach((card,index)=>{
   const cited=card.citation;
   let at=cited===undefined?-1:blocks.findIndex(block=>prose.has(block.type)&&hasCitation(block,cited));
   // Earlier conversations may only have the card name, without a citation anchor.
   if(at===-1){
    const name=card.name.toLocaleLowerCase();
    at=blocks.findIndex(block=>prose.has(block.type)&&visibleText(block).toLocaleLowerCase().includes(name));
   }
   if(at===-1)at=firstProse===-1?lastHeading+1:firstProse;
   const group=placements.get(at)??[];
   group.push(index);placements.set(at,group);
  });

  const result:MarkdownNode[]=[];
  for(let i=0;i<=blocks.length;){
   const indexes=placements.get(i);
   if(!indexes){if(i<blocks.length)result.push(blocks[i]);i++;continue}
   const start=i;
   if(i<blocks.length)i++;
   while(i<blocks.length&&!placements.has(i)&&blocks[i].type!=='heading')i++;
   const slot:MarkdownNode={type:'answerCardSlot',data:{hName:'aside',hProperties:{dataAnswerCardIndexes:indexes.join(',')}}};
   result.push({type:'answerCardPassage',children:[slot,...blocks.slice(start,i)],data:{hName:'div',hProperties:{className:['answer-card-passage']}}});
   if(start===blocks.length)break;
  }
  tree.children=result;
 };
}
