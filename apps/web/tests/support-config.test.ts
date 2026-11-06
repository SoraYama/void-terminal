import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";


const fixtureAddress = "0x1111111111111111111111111111111111111111";
const root = mkdtempSync(join(tmpdir(), "void-support-test-"));
mkdirSync(join(root, "support"));
writeFileSync(join(root, "support", "fixture.png"), "fixture only");
afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });
process.on("exit", () => rmSync(root, { force: true, recursive: true }));

it("returns only public configured details from a hosted runtime", async () => {
 const {supportConfig}=await import("../src/lib/server/support-config");
 const env = {
  SUPPORT_CONTACT_EMAIL: "operator@example.test",
  SUPPORT_WECHAT_QR_URL: "/support/fixture.png",
  SUPPORT_AFDIAN_URL: "https://afdian.com/a/fixture",
  SUPPORT_KOFI_URL: "https://ko-fi.com/fixture",
  SUPPORT_BSC_ADDRESS: fixtureAddress,
  SUPPORT_BSC_ASSETS: "BNB, USDT",
  TURNSTILE_SECRET_KEY: "must-never-serialize",
 };
 expect(supportConfig("self-hosted",env,root)).toBeUndefined();
 expect(supportConfig("hosted",{},root)).toBeUndefined();
 expect(supportConfig("hosted",env,root)).toEqual({
  contactEmail: "operator@example.test",
  channels: [
   { id:"wechat", type:"qr", url:"/support/fixture.png" },
   { id:"afdian", type:"link", url:"https://afdian.com/a/fixture" },
   { id:"kofi", type:"link", url:"https://ko-fi.com/fixture" },
  ],
  bsc:{address:fixtureAddress,assets:["BNB","USDT"],chainId:56},
 });
});

it.each([
 ["SUPPORT_WECHAT_QR_URL","//attacker.example/support/fixture.png"],
 ["SUPPORT_WECHAT_QR_URL","/support/%2e%2e/fixture.png"],
 ["SUPPORT_WECHAT_QR_URL","/support/fixture.svg"],
 ["SUPPORT_WECHAT_QR_URL","/support/missing.png"],
 ["SUPPORT_ALIPAY_QR_URL","/support/fixture.png?external=1"],
 ["SUPPORT_AFDIAN_URL","https://afdian.com.evil.test/a/fixture"],
 ["SUPPORT_AFDIAN_URL","https://user@afdian.com/a/fixture"],
 ["SUPPORT_KOFI_URL","http://ko-fi.com/fixture"],
 ["SUPPORT_KOFI_URL","https://ko-fi.com/fixture?next=https://evil.test"],
 ["SUPPORT_CONTACT_EMAIL","operator@example.test?bcc=hidden@example.test"],
 ["SUPPORT_BSC_ADDRESS","0x0000000000000000000000000000000000000000"],
 ["SUPPORT_BSC_ADDRESS","0x1234"],
 ["SUPPORT_BSC_ASSETS","BNB,ETH"],
])("hides invalid %s and logs only its key", async (name,value) => {
 const {supportConfig}=await import("../src/lib/server/support-config");
 const warn=vi.spyOn(console,"warn").mockImplementation(()=>{});
 const base = name.startsWith("SUPPORT_BSC") ? {SUPPORT_BSC_ADDRESS:fixtureAddress,SUPPORT_BSC_ASSETS:"BNB"} : {};
 expect(supportConfig("hosted",{...base,[name]:value},root)).toBeUndefined();
 expect(warn).toHaveBeenCalledWith(expect.stringContaining(name));
 expect(JSON.stringify(warn.mock.calls)).not.toContain(value);
});

it("requires both a public BSC address and explicit asset choices",async ()=>{
 const {supportConfig}=await import("../src/lib/server/support-config");
 const warn=vi.spyOn(console,"warn").mockImplementation(()=>{});
 expect(supportConfig("hosted",{SUPPORT_BSC_ADDRESS:fixtureAddress},root)).toBeUndefined();
 expect(warn).toHaveBeenCalled();
});
