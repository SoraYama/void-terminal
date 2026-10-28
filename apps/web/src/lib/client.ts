export async function request<T>(path:string,init?:RequestInit):Promise<T>{const r=await fetch(path,init);const data=await r.json();if(!r.ok)throw new Error(data.error?.message||`HTTP ${r.status}`);return data}
export function safeUrl(value:string){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:undefined}catch{return undefined}}
