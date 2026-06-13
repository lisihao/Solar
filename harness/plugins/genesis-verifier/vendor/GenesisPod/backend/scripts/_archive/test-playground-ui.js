/* eslint-disable no-console, @typescript-eslint/no-require-imports */
/**
 * Real-browser UI verification for the agent-playground demo.
 *
 * Drives Chromium via puppeteer:
 *   1. Inject JWT to localStorage (skip login flow)
 *   2. Navigate to /agent-playground/research-team
 *   3. Fill topic + click "Run"
 *   4. Wait for redirect to /[missionId]
 *   5. Capture screenshots every 8s for ~2.5 min
 *   6. Report console errors + failed network requests
 *
 * Usage: node backend/scripts/test-playground-ui.js
 */

const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const puppeteer = require("puppeteer");

const FRONTEND = "https://gens.team";
const USER_ID = "18780216-2eb9-4d82-a588-2365fd93944a";
const JWT_SECRET = "dEePdIvE-sEcUrE-jWt-ToKeN-2024-rAnDoM-kEy-X9Y8Z7";
const TOPIC = "AI agents market 2026 Q2";
const DEBUG_DIR = path.resolve(__dirname, "../../debug/playground-ui");

function mintToken() {
  return jwt.sign({ sub: USER_ID, id: USER_ID }, JWT_SECRET, {
    expiresIn: "1h",
  });
}

async function main() {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  const token = mintToken();
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const consoleErrors = [];
  const networkFails = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error") consoleErrors.push(text);
    if (
      msg.type() === "log" &&
      /agent-playground|mission|runResearchTeam/i.test(text)
    ) {
      console.log("  [browser log]", text);
    }
  });
  page.on("requestfailed", (req) => {
    networkFails.push(
      `${req.method()} ${req.url()} :: ${req.failure()?.errorText ?? "?"}`,
    );
  });
  page.on("response", (res) => {
    const u = res.url();
    if (
      res.status() >= 400 &&
      (u.includes("/api/v1/agent-playground") || u.includes("socket.io"))
    ) {
      networkFails.push(`HTTP ${res.status()} ${u}`);
    }
  });

  console.log(
    "=== Step 1: open frontend, set token + user in localStorage ===",
  );
  await page.goto(FRONTEND, { waitUntil: "networkidle0", timeout: 60_000 });
  await page.evaluate(
    ({ tok, uid }) => {
      localStorage.setItem(
        "deepdive_auth_tokens",
        JSON.stringify({ accessToken: tok, refreshToken: tok }),
      );
      // AuthContext 在 init 时同时检查 cachedUser，缺一不可
      localStorage.setItem(
        "deepdive_user",
        JSON.stringify({
          id: uid,
          email: "hello@gens.team",
          username: "junjie",
          createdAt: new Date().toISOString(),
        }),
      );
    },
    { tok: token, uid: USER_ID },
  );
  console.log("token + user planted in localStorage");

  console.log("=== Step 2: navigate to launcher ===");
  await page.goto(`${FRONTEND}/agent-playground/research-team`, {
    waitUntil: "networkidle0",
    timeout: 60_000,
  });
  await page.screenshot({
    path: path.join(DEBUG_DIR, "01-launcher.png"),
    fullPage: true,
  });

  console.log("=== Step 3: fill topic + submit ===");
  await page.evaluate((topic) => {
    const input = document.querySelector('input[type="text"]');
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      ).set;
      setter.call(input, topic);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    // pick "quick" depth
    const selects = document.querySelectorAll("select");
    if (selects[0]) {
      const setter2 = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        "value",
      ).set;
      setter2.call(selects[0], "quick");
      selects[0].dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (selects[1]) {
      const setter3 = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        "value",
      ).set;
      setter3.call(selects[1], "en-US");
      selects[1].dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, TOPIC);

  await page.screenshot({
    path: path.join(DEBUG_DIR, "02-form-filled.png"),
    fullPage: true,
  });

  // submit — use page.click + form.requestSubmit so React's onSubmit fires
  const buttonHandle = await page.$('button[type="submit"]');
  if (!buttonHandle) {
    console.error("No submit button found!");
    await browser.close();
    return;
  }
  // intercept the API response to know what the backend says
  const respPromise = page.waitForResponse(
    (r) => r.url().includes("/agent-playground/research-team/run"),
    { timeout: 30_000 },
  );
  await Promise.all([
    page
      .waitForNavigation({ waitUntil: "networkidle0", timeout: 60_000 })
      .catch(() => null),
    buttonHandle.click(),
  ]);
  const apiResp = await respPromise.catch(() => null);
  if (apiResp) {
    const status = apiResp.status();
    const body = await apiResp.text().catch(() => "");
    console.log(
      `>>> /research-team/run RESPONSE: HTTP ${status}, body=${body.slice(0, 300)}`,
    );
  } else {
    console.log(
      ">>> /research-team/run was NEVER called (form submit broken?)",
    );
  }
  console.log("submitted, current URL:", page.url());

  // 等 React 把 setError 渲染出来
  await new Promise((r) => setTimeout(r, 3_000));
  await page.screenshot({
    path: path.join(DEBUG_DIR, "03-after-submit.png"),
    fullPage: true,
  });

  // dump any error banner text
  const submitError = await page.evaluate(() => {
    const banner = document.querySelector(
      '.text-red-700, [class*="bg-red-50"]',
    );
    return banner ? banner.textContent : null;
  });
  if (submitError) console.log("FORM ERROR BANNER:", submitError);

  if (!/\/research-team\/[0-9a-f-]{36}/.test(page.url())) {
    console.error(
      "EXPECTED redirect to /research-team/<missionId>; got:",
      page.url(),
    );
    const html = await page.content();
    fs.writeFileSync(path.join(DEBUG_DIR, "03-html.html"), html);
  }

  console.log("=== Step 4: capture mission page over 2.5 min ===");
  const start = Date.now();
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 8_000));
    const elapsed = Math.floor((Date.now() - start) / 1000);
    const fname = `04-mission-${String(elapsed).padStart(3, "0")}s.png`;
    await page
      .screenshot({ path: path.join(DEBUG_DIR, fname), fullPage: true })
      .catch((e) => console.warn("screenshot failed:", e.message));
    // check terminal banners
    const status = await page.evaluate(() => {
      const txt = document.body.innerText;
      return {
        hasFailedBanner: /Mission failed/i.test(txt),
        hasCompletedScore: /Quality score/.test(txt) && /\d+/.test(txt),
        finalReportShown: /Final report|Conclusion|Executive summary/i.test(
          txt,
        ),
        text_excerpt: txt.slice(0, 400),
      };
    });
    console.log(
      `[t=${elapsed}s] failed=${status.hasFailedBanner} report=${status.finalReportShown}`,
    );
    if (status.hasFailedBanner || status.finalReportShown) {
      // wait one more tick for full render
      await new Promise((r) => setTimeout(r, 4_000));
      await page.screenshot({
        path: path.join(DEBUG_DIR, "99-final.png"),
        fullPage: true,
      });
      break;
    }
  }

  console.log("\n=== Console errors ===");
  for (const e of consoleErrors.slice(0, 20)) console.log("  -", e);
  console.log("\n=== Network failures ===");
  for (const e of networkFails.slice(0, 20)) console.log("  -", e);

  await browser.close();
  console.log(`\nScreenshots saved to ${DEBUG_DIR}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
