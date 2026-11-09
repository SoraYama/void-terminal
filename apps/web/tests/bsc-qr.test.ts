import {afterEach,expect,it,vi} from 'vitest';
import {GET} from '../src/app/api/support/bsc-qr/route';

const address='0xAbC0123456789deF000000000000000000000001';
const other='0x2222222222222222222222222222222222222222';
const request=(value=address)=>new Request(`http://localhost/api/support/bsc-qr?address=${encodeURIComponent(value)}`);
function configure(){
 vi.stubEnv('DEPLOYMENT_MODE','hosted');vi.stubEnv('SUPPORT_BSC_ADDRESS',address);vi.stubEnv('SUPPORT_BSC_ASSETS','USDT,USDC,BNB');
}
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks()});

it('serves a real PNG for the exact configured address without caching it',async()=>{
 configure();const response=await GET(request());
 expect(response.status).toBe(200);
 expect(response.headers.get('Content-Type')).toBe('image/png');
 expect(response.headers.get('Cache-Control')).toBe('no-store');
 expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
 expect(response.headers.get('Content-Disposition')).toContain('bsc-receiving-address.png');
 const bytes=Buffer.from(await response.arrayBuffer());
 expect([...bytes.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
 expect(bytes.readUInt32BE(16)).toBeGreaterThanOrEqual(256);
 expect(bytes.readUInt32BE(16)).toBe(bytes.readUInt32BE(20));
});
it('does not generate QR codes for an arbitrary, missing or stale recipient',async()=>{
 configure();
 for(const req of [request(other),request('https://example.test'),new Request('http://localhost/api/support/bsc-qr')]){
  const response=await GET(req);expect(response.status).toBe(404);expect(await response.text()).toBe('');expect(response.headers.get('Cache-Control')).toBe('no-store');
 }
 const oldBytes=await (await GET(request())).arrayBuffer();vi.stubEnv('SUPPORT_BSC_ADDRESS',other);
 expect((await GET(request())).status).toBe(404);
 const replacement=await GET(request(other));expect(replacement.status).toBe(200);
 expect(Buffer.from(await replacement.arrayBuffer())).not.toEqual(Buffer.from(oldBytes));
});
it.each(['self-hosted',''])('denies the endpoint outside hosted mode (%s)',async mode=>{
 configure();vi.stubEnv('DEPLOYMENT_MODE',mode);const response=await GET(request());
 expect(response.status).toBe(mode?404:503);expect(response.headers.get('Content-Type')).not.toBe('image/png');
});
it.each([['SUPPORT_BSC_ADDRESS',''],['SUPPORT_BSC_ADDRESS','not-an-address'],['SUPPORT_BSC_ASSETS',''],['SUPPORT_BSC_ASSETS','ETH']])('hides unavailable BSC configuration: %s=%s',async(key,value)=>{
 configure();vi.stubEnv(key,value);vi.spyOn(console,'warn').mockImplementation(()=>{});
 expect((await GET(request())).status).toBe(404);
});
