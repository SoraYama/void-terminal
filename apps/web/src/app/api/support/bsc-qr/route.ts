import QRCode from 'qrcode';
import {deploymentMode} from '../../../../lib/server/deployment';
import {errorResponse} from '../../../../lib/server/errors';
import {supportConfig} from '../../../../lib/server/support-config';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(request:Request):Promise<Response>{
 try{
  const bsc=supportConfig(deploymentMode())?.bsc;
  // Bind the image to the address displayed by the page. A stale page fails
  // closed instead of showing a newly configured, different recipient's QR.
  if(!bsc||new URL(request.url).searchParams.get('address')!==bsc.address){
   return new Response(null,{status:404,headers:{'Cache-Control':'no-store'}});
  }
  // A plain address supports all configured assets without implying a native
  // token transaction or selecting the wallet's network on the user's behalf.
  const png=await QRCode.toBuffer(bsc.address,{type:'png',errorCorrectionLevel:'M',margin:4,scale:8});
  return new Response(new Uint8Array(png),{headers:{
   'Content-Type':'image/png',
   'Content-Disposition':'inline; filename="bsc-receiving-address.png"',
   'Cache-Control':'no-store',
   'X-Content-Type-Options':'nosniff',
  }});
 }catch(error){return errorResponse(error)}
}
