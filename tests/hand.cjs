const assert = require("node:assert/strict");
const { webkit, devices } = require("playwright");

(async () => {
  const browser = await webkit.launch();
  try {
    for (const width of [320, 390]) {
      const page = await browser.newPage({
        ...devices["iPhone 13"],
        viewport: { width, height: width === 320 ? 568 : 760 },
      });
      await page.goto(process.argv[2]);
      await page.getByText("Begin expedition").click();
      await page
        .locator(".field-choices")
        .getByRole("button", { name: "Take Early bird", exact: true })
        .click();
      const rail = page.locator(".hand-rail"),
        slots = rail.locator(".fan-slot");
      await rail.scrollIntoViewIfNeeded();
      const journal = () =>
        page.evaluate(() => localStorage.getItem("mage-knight-atlas.v1"));
      const before = await journal();
      assert.ok((await rail.boundingBox()).height <= 96);
      const point = async (i) => {
        const box = await slots.nth(i).boundingBox();
        return { x: box.x + box.width / 2, y: box.y + box.height * 0.5 };
      };
      const first = await point(0),
        third = await point(2);
      const name = await slots.nth(2).locator("strong").textContent();
      await page.mouse.move(first.x, first.y);
      await page.mouse.down();
      await page.mouse.move(third.x, third.y, { steps: 8 });
      await rail
        .locator(".fan-preview strong")
        .filter({ hasText: name })
        .waitFor();
      assert.ok(await rail.locator(".fan-preview").getByText(/Basic/).count());
      await page.mouse.up();
      assert.equal(await page.locator("#sheet-title").textContent(), name);
      await page.locator("#close").click();
      await rail.scrollIntoViewIfNeeded();
      const again = await point(0);
      await page.mouse.move(again.x, again.y);
      await page.mouse.down();
      await page.mouse.move(again.x, again.y - 110);
      await page.mouse.up();
      assert.ok(!(await page.locator("#detail").isVisible()));
      assert.equal(await journal(), before);
      await slots.first().focus();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Enter");
      assert.equal(
        await page.locator("#sheet-title").textContent(),
        await slots.nth(1).locator("strong").textContent(),
      );
      await page.locator("#close").click();
      await slots.last().tap();
      await page.locator("#detail[open]").waitFor();
      await page.waitForTimeout(400); // Include WebKit’s delayed compatibility click.
      assert.equal(await journal(), before);
      assert.equal(
        await page.locator("#sheet-title").textContent(),
        await slots.last().locator("strong").textContent(),
      );
      await page.locator("#close").click();
      // Exercise pagination independently of deck shuffling or which hero was dealt.
      await page.evaluate(async () => {
        const { mountHand } = await import("./hand.js"),
          rail = document.querySelector(".hand-rail");
        const cards = Array.from({ length: 11 }, (_, i) => ({
          name: "Card " + i,
          color: "green",
          basic: "Move 2",
          powered: "Move 4",
        }));
        function draw(offset) {
          rail.replaceChildren();
          mountHand(rail, cards, offset, draw);
        }
        draw(0);
      });
      await rail.getByRole("button", { name: "Next hand cards" }).click();
      assert.equal(await slots.first().getAttribute("data-action"), "card-5");
      await rail.getByRole("button", { name: "Next hand cards" }).click();
      assert.equal(await slots.count(), 1);
      assert.equal(await slots.first().getAttribute("data-action"), "card-10");
      await rail.getByRole("button", { name: "Previous hand cards" }).click();
      assert.equal(await slots.count(), 5);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.close();
    }
    console.log(
      "PASS fan height, thumb browsing, cancel, tap, keyboard, no unintended play and larger hands at 320/390px",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
