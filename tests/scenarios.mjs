import fs from "node:fs";
import { engine } from "../web/engine.mjs";
const run = await engine(
  fs.readFileSync(new URL("../web/atlas.wasm", import.meta.url)),
);
for (const scenario of ["dungeon_lords", "mines_liberation", "druid_nights"]) {
  for (const n of [2, 3, 4]) {
    let g = run({
      setupVersion: 4,
      heroes: ["arythea", "goldyx", "tovak", "krang"].slice(0, n),
      scenario: scenario + "_" + n + "p",
      seed: 42,
    });
    let i = 0;
    while (!g.state.gameEnded && i++ < 1200) {
      const choices = g.actions.filter((a) => a !== "Undo");
      const kind = (a) => (typeof a === "string" ? a : Object.keys(a)[0]);
      const a =
        [
          "PlaceEntrance",
          "AnnounceEndOfRound",
          "EndTurn",
          "EndRest",
          "SelectTactic",
          "DeclareRest",
          "Rest",
          "PlayCardSideways",
          "PlayCardBasic",
        ]
          .map((k) => choices.find((a) => kind(a) === k))
          .find(Boolean) || choices[0];
      g = run({ action: a, epoch: g.epoch });
    }
    if (!g.state.gameEnded || !g.score)
      throw Error(scenario + " did not score");
    console.log(scenario, n, i, g.state.round);
  }
}

const setup = {
  setupVersion: 4,
  heroes: ["wolfhawk"],
  scenario: "lost_relic_solo",
  seed: 41,
};
let relic = run(setup);
const chosen = [];
function act(action) {
  chosen.push(action);
  relic = run({ action, epoch: relic.epoch });
}
if (relic.state.map.tiles.length !== 1 || relic.actions.length !== 2)
  throw Error("Lost Relic must start with the skill draft");
try {
  run({ action: "FinishPreparation", epoch: relic.epoch });
  throw Error("Draft bypass");
} catch (e) {
  if (e.message === "Draft bypass") throw e;
}
act(relic.actions[0]);
act(relic.actions.find((a) => a.PrepareExpedition?.kind === "advanced action"));
act(relic.actions.find((a) => a.PrepareExpedition?.kind === "artifact"));
act(relic.actions.find((a) => a.PrepareExpedition?.kind === "crystal"));
act("FinishPreparation");
if (
  relic.state.map.tiles.length !== 4 ||
  relic.state.players[0].fame !== 10 ||
  relic.state.players[0].level !== 3
)
  throw Error("Invalid level 3 start");
for (let step = 0; step < 600 && !relic.state.gameEnded; step++) {
  const choices = relic.actions.filter((a) => a !== "Undo");
  const priorities = [
    "AnnounceEndOfRound",
    "EndTurn",
    "EndRest",
    "SelectTactic",
    "DeclareRest",
    "PlayCardSideways",
  ];
  act(
    priorities
      .map((k) =>
        choices.find(
          (a) => (typeof a === "string" ? a : Object.keys(a)[0]) === k,
        ),
      )
      .find(Boolean) || choices[0],
  );
}
if (
  relic.state.round !== 2 ||
  relic.score?.player_results[0].outcome !== "defeat"
)
  throw Error("Lost Relic did not end at second night");
const expected = JSON.stringify(relic);
relic = run(setup);
for (const action of chosen) relic = run({ action, epoch: relic.epoch });
if (expected !== JSON.stringify(relic))
  throw Error("Lost Relic replay diverged");
console.log(
  "PASS solo Lost Relic preparation, defeat clock and replay",
  chosen.length,
  "actions",
);
