const { webkit, devices } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const b = await webkit.launch();
  try {
    // Each fixture is a real journal ending immediately before the interaction under test.
    const url = process.argv[2],
      fixtures = require("./fixtures/solo-scenes.json");
    const p = await b.newPage({
      ...devices["iPhone 13"],
      viewport: { width: 390, height: 760 },
      deviceScaleFactor: 1,
    });
    const errors = [];
    p.on("pageerror", (e) => errors.push(String(e.stack || e.message)));
    await p.goto(url);
    await p.getByText("Begin expedition").waitFor();
    const load = async ({ init, steps }) => {
      await p.evaluate(
        (j) => localStorage.setItem("mage-knight-atlas.v1", JSON.stringify(j)),
        { init, steps },
      );
      await p.goto(url);
      await p.locator(".field").waitFor();
    };
    const journal = () =>
      p.evaluate(() =>
        JSON.parse(localStorage.getItem("mage-knight-atlas.v1")),
      );
    await load(fixtures.move);
    const map = p.locator(".map");
    const originalHeight = await map.evaluate(
      (svg) => svg.getBoundingClientRect().height,
    );
    await map.evaluate((svg) => {
      for (const [event, span] of [
        ["touchstart", 30],
        ["touchmove", 55],
        ["touchend", 0],
      ]) {
        const e = new Event(event, { bubbles: true, cancelable: true });
        Object.defineProperty(e, "touches", {
          value: span
            ? [
                { clientX: 90 - span, clientY: 100 },
                { clientX: 90 + span, clientY: 100 },
              ]
            : [],
        });
        svg.dispatchEvent(e);
      }
    });
    assert.ok(
      (await map.evaluate((svg) => svg.getBoundingClientRect().height)) >
        originalHeight,
    );
    await p.getByRole("button", { name: "Centre on hero" }).click();
    let dest = fixtures.move.action.Move.target;
    await p.getByRole("button", { name: "Inspect hexes", exact: true }).click();
    await p.locator('[data-hex="' + dest.q + "," + dest.r + '"]').click();
    await p.locator("#close").click();
    assert.equal((await journal()).steps.length, fixtures.move.steps.length);
    await p
      .getByRole("button", { name: "Inspecting hexes", exact: true })
      .click();
    await p.locator('[data-hex="' + dest.q + "," + dest.r + '"]').click();
    assert.deepEqual((await journal()).steps.at(-1), fixtures.move.action);
    await load(fixtures.Explore);
    await p.locator(".frontier").first().click();
    assert.ok((await journal()).steps.at(-1).Explore);
    await load(fixtures.RecruitUnit);
    await p.locator('.market-card[data-offer="utem_guardsmen"]').click();
    await p
      .locator("#detail")
      .getByRole("button", { name: /^Recruit Utem/ })
      .click();
    assert.deepEqual(
      (await journal()).steps.at(-1),
      fixtures.RecruitUnit.action,
    );
    const battle = fixtures.battle;
    await load(battle);
    const finish = p.getByRole("button", {
      name: "Finish this phase",
      exact: true,
    });
    await finish.click();
    await p.locator(".block-readout").first().waitFor();
    await finish.click();
    await finish.click();
    await p.locator(".hand-rail button").filter({ hasText: "Rage" }).click();
    await p
      .locator("#detail button")
      .filter({ hasText: /Play powered effect/ })
      .click();
    await p.locator(".target-foe").first().click();
    await p
      .getByRole("button", { name: "Strike targets", exact: true })
      .click();
    await finish.click();
    assert.equal(await p.locator(".battle-stage").count(), 0);
    assert.match(await p.locator(".hero-hud").innerText(), /Fame 1/);
    await p.reload();
    await p.locator(".hero-hud").waitFor();
    assert.match(await p.locator(".hero-hud").innerText(), /Fame 1/);
    await load(fixtures.level);
    const draft = p.locator(".decision-stage");
    await draft
      .getByRole("button", { name: /^Learn / })
      .first()
      .click();
    await draft
      .getByRole("button", { name: /^Take / })
      .first()
      .click();
    assert.ok((await journal()).steps.at(-1).ChooseLevelUpAdvancedAction);
    assert.deepEqual(errors, []);
    console.log(
      "PASS inspect, one-tap move, frontier exploration, legal purchase, all four combat phases, powered card, target, strike, fame, reload and level-up reward",
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
