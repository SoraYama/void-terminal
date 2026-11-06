export function creditResetLabel(value:string|undefined,zh:boolean){
 if(!value)return null;
 const date=new Date(value);
 if(!Number.isFinite(date.getTime()))return null;
 const when=new Intl.DateTimeFormat(zh?'zh-CN':'en-GB',{
  timeZone:'Asia/Shanghai',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23',
 }).format(date);
 return zh?`北京时间 ${when}`:`${when} (Beijing time)`;
}
