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
  const artwork = await page.evaluate(async () => {
    const { catalog, faces, pieceId } = await import("./artwork.js");
    const ids = Object.keys(catalog.items);
    for (const id of ids)
      if (!faces[id]) throw Error("Missing component face " + id);
    for (const component of [
      "Noble Manners",
      "Hero (White)",
      "Starting_A",
      "Orc Stonethrowers",
      "Herbalist",
      "Gold Mana",
    ]) {
      if (!pieceId(component.toLowerCase().replaceAll(" ", "_")))
        throw Error("Missing named artwork " + component);
    }
    const paths = [...new Set(Object.values(faces))];
    for (let i = 0; i < paths.length; i += 16) {
      await Promise.all(
        paths.slice(i, i + 16).map(async (path) => {
          const image = new Image();
          image.src = path;
          await image.decode();
          if (!image.naturalWidth) throw Error("Image did not decode: " + path);
        }),
      );
    }
    return [ids.length, paths.length];
  });
  console.log("PASS offline catalog and decoded images", ...artwork);
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "PASS mobile WebKit: tactic, deed play, reload, expansion table, tile placement, end turn, persisted table and offline reload",
  );
  await page.getByText("Expeditions", { exact: true }).click();
  await page.locator("#scenario").selectOption("lost_relic_solo");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByText("Begin expedition").click();
  await page
    .getByRole("button", { name: /^Learn / })
    .first()
    .click();
  await page
    .getByRole("button", { name: / · free$/ })
    .first()
    .click();
  await page.getByRole("button", { name: /Finish preparation/i }).click();
  await page.getByRole("button", { name: "Early bird", exact: true }).click();
  await page
    .getByText(/Relic pieces recovered/)
    .first()
    .waitFor();
  console.log("PASS offline Lost Relic draft, tactic and objective");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
