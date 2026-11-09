'use client';
import {useRef,useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {ArrowSquareOut,Copy,X} from '@phosphor-icons/react';
import type {SupportChannel,SupportConfig} from '../lib/support-contracts';
import {Ornament} from './ui';

export function CopyField({value,label,copyLabel,zh,rows=2,code=false}:{value:string;label:string;copyLabel:string;zh:boolean;rows?:number;code?:boolean}){
 const field=useRef<HTMLTextAreaElement>(null);
 const [feedback,setFeedback]=useState<'copied'|'manual'|null>(null);
 async function copy(){
  try{await navigator.clipboard.writeText(value);setFeedback('copied')}
  catch{field.current?.focus();field.current?.select();setFeedback('manual')}
 }
 return <div className="support-copy">
  <label>{label}<textarea ref={field} className={code?'support-code':undefined} rows={rows} readOnly value={value}/></label>
  <div className="support-actions"><button type="button" onClick={()=>void copy()}><Copy size={16}/>{copyLabel}</button>
   <span role="status">{feedback==='copied'?(zh?'已复制':'Copied'):feedback==='manual'?(zh?'已选中文本，请手动复制。':'Text selected. Copy manually.'):''}</span>
  </div>
 </div>;
}

const channelNames={wechat:['微信','WeChat'],alipay:['支付宝','Alipay'],afdian:['爱发电','Afdian'],kofi:['Ko-fi','Ko-fi']};
function Channel({channel,zh}:{channel:SupportChannel;zh:boolean}){
 const [failed,setFailed]=useState(false);
 const name=channelNames[channel.id][zh?0:1];
 if(channel.type==='link')return <a className="support-link" href={channel.url} target="_blank" rel="noopener noreferrer">{zh?`前往 ${name}`:`Open ${name}`}<ArrowSquareOut size={15} aria-hidden="true"/></a>;
 if(failed)return null;
 return <details className="support-qr"><summary>{name}</summary>
  {/* Render the original same-site image to preserve the QR's crisp edges. */}
  {/* eslint-disable-next-line @next/next/no-img-element */}
  <img src={channel.url} alt={zh?`${name}赞助二维码`:`${name} sponsorship QR code`} width={180} height={180} onError={()=>setFailed(true)}/>
  <p className="account-policy">{zh?`用 ${name} 扫码；如果在同一部手机上，先保存二维码，再在扫码功能中从相册选择。`:`Scan with ${name}. On the same phone, save the QR image first, then select it from the scanner’s photo library.`}</p>
  <a className="support-link" href={channel.url} download>{zh?'保存二维码':'Save QR image'}</a>
 </details>;
}

function BscQr({address,zh}:{address:string;zh:boolean}){
 const [failed,setFailed]=useState(false);
 const url=`/api/support/bsc-qr?address=${encodeURIComponent(address)}`;
 return <details className="support-qr"><summary>{zh?'显示地址二维码':'Show address QR code'}</summary>
  <p className="account-policy">{zh?'二维码只包含收款地址。扫码后请在钱包中选择 BSC 主网和正确币种；同一部手机可先保存图片，再从相册扫码。':'The QR contains only the address. Choose BSC mainnet and the correct asset in your wallet. On the same phone, save the image and scan it from your photo library.'}</p>
  {failed?<p className="account-policy" role="status">{zh?'二维码暂时无法加载，请复制上方收款地址。':'The QR image could not load. Copy the receiving address above.'}</p>:<>
   {/* Keep the generated PNG intact and off third-party image services. */}
   {/* eslint-disable-next-line @next/next/no-img-element */}
   <img src={url} alt={zh?'BSC 收款地址二维码':'BSC receiving address QR code'} width={180} height={180} loading="lazy" onError={()=>setFailed(true)}/>
   <a className="support-link" href={url} download="bsc-receiving-address.png">{zh?'保存 BSC 二维码':'Save BSC QR image'}</a>
  </>}
 </details>;
}

export function SupportPanel({open,onOpenChange,onCloseFocus,support,zh}:{open:boolean;onOpenChange:(open:boolean)=>void;onCloseFocus:()=>void;support:SupportConfig;zh:boolean}){
 const domestic=support.channels.filter(item=>item.id!=='kofi'),international=support.channels.filter(item=>item.id==='kofi');
 const {bsc}=support;
 return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
  <Dialog.Overlay className="overlay"/>
  <Dialog.Content className="settings-dialog account-dialog support-dialog" onCloseAutoFocus={event=>{event.preventDefault();onCloseFocus()}}>
   <Dialog.Title>{zh?'支持虚空终端':'Support the project'}</Dialog.Title>
   <Dialog.Description className="account-description">{zh?'虚空终端由个人维护。你的支持将帮助承担模型调用与服务器费用。赞助完全自愿，不影响免费点数，也不兑换额外额度。':'Void Terminal is independently maintained. Your support helps cover model and server costs. Sponsorship is optional and does not affect free credits or grant additional credits.'}</Dialog.Description>
   <Dialog.Close className="dialog-close" aria-label={zh?'关闭':'Close'}><X size={24}/></Dialog.Close><Ornament/>
   {domestic.length>0&&<section className="support-section"><h3>{zh?'国内渠道':'Mainland China'}</h3>{domestic.map(channel=><Channel key={channel.id} channel={channel} zh={zh}/>)}</section>}
   {international.length>0&&<section className="support-section"><h3>{zh?'海外渠道':'International'}</h3>{international.map(channel=><Channel key={channel.id} channel={channel} zh={zh}/>)}</section>}
   {bsc&&<section className="support-section">
    <h3>BNB Smart Chain (BSC/BEP-20)</h3>
    <p className="support-chain">{zh?`主网 · 链 ID ${bsc.chainId}`:`Mainnet · Chain ID ${bsc.chainId}`}<span>{bsc.assets.join(' · ')}</span></p>
    <CopyField label={zh?'收款地址':'Receiving address'} copyLabel={zh?'复制地址':'Copy address'} value={bsc.address} zh={zh} code/>
    <BscQr key={bsc.address} address={bsc.address} zh={zh}/>
    <p className="account-policy">{zh?'转账时请选择 BSC 主网，并核对网络和完整地址。':'Choose BSC mainnet when transferring, and double-check the network and full address.'}</p>
    <a className="support-link" href={`https://bscscan.com/address/${bsc.address}`} target="_blank" rel="noopener noreferrer">{zh?'在 BscScan 查看地址':'View address on BscScan'}<ArrowSquareOut size={15} aria-hidden="true"/></a>
   </section>}
  </Dialog.Content>
 </Dialog.Portal></Dialog.Root>;
}
