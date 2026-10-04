"use strict";
const assert = require("node:assert/strict"),
  { spawn } = require("node:child_process"),
  fs = require("node:fs"),
  path = require("node:path");
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require(process.env.PLAYWRIGHT_MODULE));
}
const root = path.join(__dirname, "..");
async function go(page, section) {
  await page.locator(`nav a[href="#${section}"]`).click();
  await page.waitForFunction(
    (k) =>
      document.querySelector("main h1")?.textContent ===
      I18N[document.documentElement.lang][k === "overview" ? "welcome" : k],
    section,
  );
}
(async () => {
  fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
  const server = spawn(process.execPath, ["src/server/main.cjs"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: "3117",
      DB_PATH: path.join(root, "artifacts", `ui-${Date.now()}.sqlite`),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let browser;
  try {
    await new Promise((r, j) => {
      server.stdout.once("data", r);
      server.once("error", j);
      server.once("exit", (c) => j(Error("Server exit " + c)));
    });
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1100 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:3117");
    await page.locator("#auth-switch").click();
    await page.locator("#auth-name").fill("UI Tester");
    await page.locator("#auth-email").fill("ui@example.test");
    await page.locator("#auth-password").fill("UI-test-password-2026");
    await page.locator("#auth-submit").click();
    await page.locator("nav").waitFor();
    await page.locator('[data-calc="step"]').click();
    await page.waitForFunction(() =>
      document.querySelector(".clock")?.textContent.includes("00:15:00"),
    );
    await page.locator('[data-calc="reset"]').click();
    await page.waitForFunction(() =>
      document.querySelector(".clock")?.textContent.includes("00:00:00"),
    );
    for (const key of ["base", "delay", "breakdown", "operator", "expedite"]) {
      await go(page, "scenarios");
      await page.locator("#template").selectOption(key);
      await page.waitForFunction(
        () => !document.querySelector('[data-calc="end"]').disabled,
      );
      await page.locator('[data-calc="end"]').click();
      await page.waitForFunction(() =>
        document.querySelector(".clock")?.textContent.includes("08:00:00"),
      );
      const vals = await page
        .locator("#comparison td:nth-child(3)")
        .allTextContents();
      assert.equal(
        vals[1],
        key === "delay" ? "26" : key === "breakdown" ? "27" : "28",
      );
      await page.locator('[data-calc="end"]').click();
      await page.waitForFunction(
        () => !document.querySelector('[data-calc="end"]').disabled,
      );
      assert.deepEqual(
        await page.locator("#comparison td:nth-child(3)").allTextContents(),
        vals,
      );
    }
    await page.locator("#scenario-name").fill("My saved plan");
    await page.locator("#save-scenario").click();
    await page.locator("[data-scenario]").waitFor();
    await page.locator('[data-calc="save"]').click();
    await page.waitForFunction(
      () => !document.querySelector('[data-calc="save"]').disabled,
    );
    for (const locale of ["ru", "kk", "en"]) {
      await page.locator("#language").selectOption(locale);
      await page.waitForFunction(
        (l) => document.documentElement.lang === l,
        locale,
      );
      for (const section of [
        "overview",
        "line",
        "scenarios",
        "resources",
        "profile",
      ]) {
        await page.locator(`nav a[href="#${section}"]`).click();
        await page.waitForFunction(
          (k) =>
            document.querySelector("main h1")?.textContent ===
            I18N[document.documentElement.lang][
              k === "overview" ? "welcome" : k
            ],
          section,
        );
        assert.equal(await page.locator("main h1").count(), 1);
        assert.ok(
          !(await page.locator("main").innerText()).includes("undefined"),
        );
      }
      await go(page, "line");
      await page.waitForFunction(
        () =>
          document.querySelector("main h1")?.textContent ===
          I18N[document.documentElement.lang].line,
      );
      if (locale === "en")
        assert.ok(!/[А-Яа-яЁё]/.test(await page.locator("main").innerText()));
      await page.screenshot({
        path: path.join(root, `artifacts/app-${locale}-desktop.png`),
        fullPage: true,
      });
    }
    await go(page, "profile");
    await page.locator('#profile-form [name="name"]').fill("Updated UI name");
    await page.locator("#profile-form button").click();
    await page.waitForFunction(() =>
      document
        .querySelector("nav .account")
        .textContent.includes("Updated UI name"),
    );
    await page.reload();
    await page.locator("nav").waitFor();
    assert.equal(
      await page.locator('#profile-form [name="name"]').inputValue(),
      "Updated UI name",
    );
    assert.equal(await page.locator("#language").inputValue(), "en");
    await go(page, "scenarios");
    assert.ok((await page.locator("[data-scenario]").count()) === 1);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const section of [
      "overview",
      "line",
      "scenarios",
      "resources",
      "profile",
    ]) {
      await go(page, section);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        section + " mobile overflow",
      );
    }
    await go(page, "overview");
    await page.screenshot({
      path: path.join(root, "artifacts/app-en-mobile.png"),
      fullPage: true,
    });
    await page.keyboard.press("Tab");
    assert.ok(
      await page.evaluate(() => document.activeElement.tagName !== "BODY"),
    );
    await page.locator("#logout").click();
    await page.locator("#auth-form").waitFor();
    await page.locator("#auth-email").fill("ui@example.test");
    await page.locator("#auth-password").fill("UI-test-password-2026");
    await page.locator("#auth-submit").click();
    await page.locator("nav").waitFor();
    assert.equal(await page.locator("#language").inputValue(), "en");
    assert.deepEqual(errors, []);
    console.log(
      "PASS UI: registration/login/logout, five scenarios, repeated run/reset, saved scenario/run, profile/reload, 3 locales x 5 pages, mobile widths, keyboard, zero JS errors",
    );
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
