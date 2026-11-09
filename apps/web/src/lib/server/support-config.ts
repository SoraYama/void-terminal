import 'server-only';
import {realpathSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {z} from 'zod';
import type {DeploymentMode} from '../deployment';
import {BSC_SUPPORT_ASSETS,type BscSupportAsset,type SupportChannel,type SupportConfig} from '../support-contracts';

function localQr(value:string,publicDir:string){
 if(!/^\/support\/[a-z0-9][a-z0-9._-]{0,95}\.(?:png|webp|jpe?g)$/i.test(value)||!value.startsWith('/support/'))return false;
 try{
  const root=realpathSync(publicDir),file=join(root,value);
  return realpathSync(file)===file&&statSync(file).isFile();
 }catch{return false}
}

const providers={
 afdian:{hosts:['afdian.com','www.afdian.com','afdian.net','www.afdian.net'],path:/^\/a\/[a-z0-9_-]+\/?$/i},
 kofi:{hosts:['ko-fi.com','www.ko-fi.com'],path:/^\/[a-z0-9_-]+\/?$/i},
};
function providerLink(value:string,id:'afdian'|'kofi'){
 if(!value.startsWith('https://')||/[\\\s\u0000-\u001f\u007f?#]/.test(value))return false;
 try{
  const url=new URL(value),provider=providers[id];
  return !url.username&&!url.password&&!url.port&&provider.hosts.includes(url.hostname)&&provider.path.test(url.pathname)&&url.pathname===value.slice(value.indexOf('/',8));
 }catch{return false}
}

const logged=new Set<string>();
function invalid(key:string){
 if(logged.has(key))return;
 logged.add(key);
 console.warn(`Ignoring invalid or incomplete sponsorship setting: ${key}`);
}

/** Read only the public allowlist at request time; nothing is exposed by self-hosted deployments. */
export function supportConfig(mode:DeploymentMode,env:Readonly<Record<string,string|undefined>>=process.env,publicDir=resolve('public')):SupportConfig|undefined{
 if(mode!=='hosted')return undefined;
 const channels:SupportChannel[]=[];
 const read=(key:string)=>env[key]?.trim()||undefined;
 for(const [id,key] of [['wechat','SUPPORT_WECHAT_QR_URL'],['alipay','SUPPORT_ALIPAY_QR_URL']] as const){
  const url=read(key);if(!url)continue;
  if(localQr(url,publicDir))channels.push({id,type:'qr',url});else invalid(key);
 }
 for(const [id,key] of [['afdian','SUPPORT_AFDIAN_URL'],['kofi','SUPPORT_KOFI_URL']] as const){
  const url=read(key);if(!url)continue;
  if(providerLink(url,id))channels.push({id,type:'link',url});else invalid(key);
 }
 const email=read('SUPPORT_CONTACT_EMAIL');
 const contactEmail=email&&email.length<=254&&z.email().safeParse(email).success?email:undefined;
 if(email&&!contactEmail)invalid('SUPPORT_CONTACT_EMAIL');
 let bsc:SupportConfig['bsc'];
 const address=read('SUPPORT_BSC_ADDRESS'),assetList=read('SUPPORT_BSC_ASSETS');
 if(address||assetList){
  const assets=assetList?.split(',').map(asset=>asset.trim())||[];
  const validAssets=assets.length>0&&assets.every((asset):asset is BscSupportAsset=>BSC_SUPPORT_ASSETS.some(allowed=>allowed===asset));
  const validAddress=address&&/^0x[0-9a-fA-F]{40}$/.test(address)&&!/^0x0{40}$/i.test(address);
  if(!validAddress)invalid('SUPPORT_BSC_ADDRESS');
  if(!validAssets)invalid('SUPPORT_BSC_ASSETS');
  if(validAddress&&validAssets)bsc={address,assets:[...new Set(assets)],chainId:56};
 }
 return contactEmail||channels.length||bsc?{...(contactEmail?{contactEmail}:{}),channels,...(bsc?{bsc}:{})}:undefined;
}
