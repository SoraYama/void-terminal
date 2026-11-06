import {defineConfig,devices} from '@playwright/test';
const baseURL=process.env.PLAYWRIGHT_BASE_URL||'http://127.0.0.1:3100';
const hostedURL=process.env.PLAYWRIGHT_HOSTED_BASE_URL||'http://127.0.0.1:3101';
// Both servers use the same production build. Keep credentials empty even if the
// developer shell contains live ones; account/model successes are browser fixtures.
const isolatedEnv={ACCOUNT_TRIAL_ENABLED:'false',SUPABASE_URL:'',SUPABASE_PUBLISHABLE_KEY:'',TRIAL_ALLOWED_EMAILS:'',SHARED_MODE_ENABLED:'false',DEEPSEEK_API_KEY:'',SESSION_SECRET:'',KNOWLEDGE_URL:'http://127.0.0.1:9',KNOWLEDGE_API_TOKEN:'',SUPPORT_CONTACT_EMAIL:'fixture@example.test',SUPPORT_KOFI_URL:'https://ko-fi.com/fixture-only',SUPPORT_BSC_ADDRESS:'0x1111111111111111111111111111111111111111',SUPPORT_BSC_ASSETS:'BNB,USDT'};
const hostedTests=/(account-trial|deployment-modes)\.spec\.ts/;
export default defineConfig({
 // Playwright resolves command cwd from this config directory (apps/web).
 webServer:[
  ...process.env.PLAYWRIGHT_BASE_URL?[]:[{command:'npm run start -- --hostname 127.0.0.1 --port 3100',url:baseURL,env:{...isolatedEnv,DEPLOYMENT_MODE:'self-hosted'},reuseExistingServer:false,timeout:120_000}],
  ...process.env.PLAYWRIGHT_HOSTED_BASE_URL?[]:[{command:'npm run start -- --hostname 127.0.0.1 --port 3101',url:hostedURL,env:{...isolatedEnv,DEPLOYMENT_MODE:'hosted',SUPPORT_CONTACT_EMAIL:process.env.PLAYWRIGHT_WITHOUT_CONTACT==='1'?'':isolatedEnv.SUPPORT_CONTACT_EMAIL},reuseExistingServer:false,timeout:120_000}],
 ],
 testDir:'./tests/e2e', timeout:45_000, fullyParallel:false, workers:1,
 expect:{timeout:10_000},reporter:[['list'],['html',{outputFolder:'../../artifacts/playwright-report',open:'never'}]],
 outputDir:'../../artifacts/playwright-results',
 use:{baseURL,trace:'retain-on-failure',screenshot:'only-on-failure',launchOptions:{ignoreDefaultArgs:['--hide-scrollbars'],...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})}},
 projects:[
  {name:'desktop',testIgnore:/account-trial\.spec\.ts/,metadata:{deploymentMode:'self-hosted'},use:{viewport:{width:1440,height:900}}},
  {name:'mobile',testIgnore:/account-trial\.spec\.ts/,metadata:{deploymentMode:'self-hosted'},use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}},
  {name:'hosted-desktop',testMatch:hostedTests,metadata:{deploymentMode:'hosted'},use:{baseURL:hostedURL,viewport:{width:1440,height:900}}},
  {name:'hosted-mobile',testMatch:hostedTests,metadata:{deploymentMode:'hosted'},use:{baseURL:hostedURL,...devices['iPhone 13'],defaultBrowserType:'chromium'}},
 ],
});
