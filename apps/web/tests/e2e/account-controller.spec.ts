import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { build } from "vite";

const origin = "https://account-controller.test";
const user = { id: "fixture-user", email: "fixture@example.test" };
const challenge = { status: "verification_required", siteKey: "fixture-key", challengeAction: "account_device" };
let script: string;

test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      write: false,
      lib: {
        entry: resolve(__dirname, "../helpers/account-controller-browser.ts"),
        name: "AccountControllerFixture",
        formats: ["iife"],
      },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!output || !("output" in output)) throw new Error("Expected a browser bundle");
  const chunk = output.output.find(item => item.type === "chunk");
  if (!chunk || chunk.type !== "chunk") throw new Error("Missing browser fixture script");
  script = chunk.code;
});

for (const scenario of [
  { title: "expired session", error: "DEVICE_CHALLENGE_FAILED", status: 403,
    setCookie: "session=; Path=/; Max-Age=0; HttpOnly; Secure", identity: "signed-out", risk: "verification_required" },
  { title: "summary outage after proof issuance", error: "KNOWLEDGE_UNAVAILABLE", status: 503,
    setCookie: "proof=verified; Path=/; HttpOnly; Secure", identity: user.id, risk: "verified" },
]) {
  test(`device error reconciles cookie changes after ${scenario.title}`, async ({ page, context }) => {
    await context.addCookies([{ name: "session", value: "signed-in", url: origin, httpOnly: true, secure: true }]);
    await page.route(`${origin}/**`, async route => {
      const request = route.request();
      const cookie = await request.headerValue("cookie") ?? "";
      switch (new URL(request.url()).pathname) {
        case "/":
          return route.fulfill({ contentType: "text/html", body: '<div id="fixture"></div><output id="broadcast"></output>' });
        case "/api/account": {
          const authenticated = cookie.includes("session=signed-in");
          return route.fulfill({ json: {
            enabled: true, authenticated, ...(authenticated ? { user } : {}),
            risk: cookie.includes("proof=verified") ? { status: "verified" } : challenge,
          } });
        }
        case "/api/account/verify-device":
          return route.fulfill({ status: scenario.status, headers: { "Set-Cookie": scenario.setCookie },
            json: { error: { code: scenario.error, message: "Verification request failed" } } });
        default:
          return route.abort();
      }
    });
    await page.goto(origin);
    await page.addScriptTag({ content: script });
    await expect(page.locator("#identity")).toHaveText(user.id);
    await expect(page.locator("#risk")).toHaveText("verification_required");

    await page.getByRole("button", { name: "Verify device" }).click();

    await expect(page.locator("#failure")).toHaveText(scenario.error);
    await expect(page.locator("#identity")).toHaveText(scenario.identity, { timeout: 3000 });
    await expect(page.locator("#risk")).toHaveText(scenario.risk, { timeout: 3000 });
    await expect(page.locator("#broadcast")).toHaveText("changed", { timeout: 3000 });
  });
}
