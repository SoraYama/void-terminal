export type SupportChannel =
 | {id:'wechat'|'alipay';type:'qr';url:string}
 | {id:'afdian'|'kofi';type:'link';url:string};

export interface SupportConfig {
 contactEmail?:string;
 channels:SupportChannel[];
 bsc?:{address:string;assets:('BNB'|'USDT')[];chainId:56};
}
