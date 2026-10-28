import {defineConfig,devices} from '@playwright/test';
const baseURL=process.env.PLAYWRIGHT_BASE_URL||'http://127.0.0.1:3000';
export default defineConfig({
 // Playwright resolves command cwd from this config directory (apps/web).
 webServer:process.env.PLAYWRIGHT_BASE_URL?undefined:{command:'npm run start',url:baseURL,reuseExistingServer:!process.env.CI,timeout:120_000},
 testDir:'./tests/e2e', timeout:45_000, fullyParallel:false, workers:1,
 expect:{timeout:10_000},reporter:[['list'],['html',{outputFolder:'../../artifacts/playwright-report',open:'never'}]],
 outputDir:'../../artifacts/playwright-results',
 use:{baseURL,trace:'retain-on-failure',screenshot:'only-on-failure',launchOptions:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}},
 projects:[{name:'desktop',use:{viewport:{width:1440,height:900}}},{name:'mobile',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}}],
});
