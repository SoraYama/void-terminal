import './archive-skeleton.css';

export function ArchiveSkeleton({width='100%',height='0.75em',className=''}:{width?:string;height?:string;className?:string}){
 return <span aria-hidden="true" className={`archive-skeleton ${className}`} style={{inlineSize:width,blockSize:height}}/>;
}

export function ArchivePendingValue(){
 return <span className="archive-pending-value" aria-hidden="true">—</span>;
}
