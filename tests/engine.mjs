import fs from "node:fs";
import assert from "node:assert/strict";
import { engine } from "../web/engine.mjs";
const bytes = fs.readFileSync(new URL("../web/atlas.wasm", import.meta.url));
const run = await engine(bytes);
const heroes = [
  "arythea",
  "goldyx",
  "tovak",
  "norowas",
  "krang",
  "wolfhawk",
  "braevalar",
];
for (const h of heroes) {
  const g = run({ setupVersion: 2, heroes: [h], scenario: "solo", seed: 17 });
  assert.equal(g.state.players[0].hand.length, 5);
  assert.equal(g.actions.length, 6);
  assert.equal(g.state.map.tiles.length, 3);
}
for (const seats of [2, 3, 4])
  for (const scenario of [
    "first_reconnaissance",
    "full_conquest",
    "blitz_conquest",
  ]) {
    let g = run({
      setupVersion: 2,
      heroes: heroes.slice(0, seats),
      scenario: scenario + "_" + seats + "p",
      seed: 42,
    });
    for (let i = 0; i < seats; i++) {
      assert(g.actions[0].SelectTactic);
      g = run({ action: g.actions[0], epoch: g.epoch });
    }
    assert.equal(g.state.roundPhase, "player_turns");
  }
let g = run({ setupVersion: 2, heroes: ["krang"], scenario: "solo", seed: 34 });
const history = [];
const kind = (a) => (typeof a === "string" ? a : Object.keys(a)[0]);
for (let i = 0; i < 1500 && !g.state.gameEnded; i++) {
  const choices = g.actions.filter((a) => kind(a) !== "Undo");
  const action =
    [
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
  assert(action, "No legal action before end");
  history.push(action);
  g = run({ action, epoch: g.epoch });
}
console.log(
  "final",
  history.length,
  g.state.round,
  g.state.gameEnded,
  JSON.stringify(g.score).slice(0, 65),
);
assert(g.state.gameEnded);
assert(g.score);
console.log(
  "PASS seven solo heroes, nine hotseat configurations, completed solo clock, final scoring",
);
