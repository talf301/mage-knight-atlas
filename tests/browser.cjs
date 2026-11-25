const { webkit, devices } = require("playwright");
(async () => {
  const browser = await webkit.launch();
  const ctx = await browser.newContext(devices["iPhone 13"]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.argv[2]);
  await page.getByText("Begin expedition").click();
  await page.getByText("Early bird", { exact: true }).click();
  await page.getByRole("button", { name: "Hand", exact: true }).click();
  await page.locator(".card").first().click();
  await page.locator("dialog [data-action^=act]").first().click();
  await page.reload();
  await page.getByText("Expedition restored").waitFor();
  await page.getByText("Expeditions", { exact: true }).click();
  await page.getByText("Open Ultimate Edition tabletop").click();
  await page.locator("#sc").selectOption("Life and Death");
  await page.getByText("Lay out components").click();
  await page.getByText("Build map stack").click();
  await page.getByText("Build stack", { exact: true }).click();
  await page.getByText("Explore · place next tile").click();
  await page.locator(".board-scroll").click({ position: { x: 50, y: 50 } });
  await page.getByRole("button", { name: "Hand", exact: true }).click();
  await page.locator(".spread button").first().click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByText("End turn", { exact: true }).click();
  await page.reload();
  await page.getByRole("heading", { name: "Life and Death" }).waitFor();
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Page wider than iPhone");
  await page.goto(new URL("./", page.url()).href);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await ctx.setOffline(true);
  await page.reload();
  await page.getByText("Expedition restored").waitFor();
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "PASS mobile WebKit: tactic, deed play, reload, expansion table, tile placement, end turn, persisted table and offline reload",
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
