export type SupportChannel =
 | {id:'wechat'|'alipay';type:'qr';url:string}
 | {id:'afdian'|'kofi';type:'link';url:string};

export const BSC_SUPPORT_ASSETS=['BNB','USDT','USDC'] as const;
export type BscSupportAsset=(typeof BSC_SUPPORT_ASSETS)[number];

export interface SupportConfig {
 contactEmail?:string;
 channels:SupportChannel[];
 bsc?:{address:string;assets:BscSupportAsset[];chainId:56};
}
