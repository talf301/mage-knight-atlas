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

for (const [scenario, seats] of [
  ["solo_conquest", 1],
  ["full_cooperation_2p", 2],
  ["full_cooperation_3p", 3],
  ["blitz_cooperation_2p", 2],
  ["blitz_cooperation_3p", 3],
]) {
  const init = {
    setupVersion: 4,
    heroes: heroes.slice(0, seats),
    scenario,
    seed: 720,
  };
  let g = run(init),
    retired = 0;
  assert.equal(g.state.deckCounts.artifacts, 25);
  assert.equal(g.state.map.tiles.length, seats === 1 ? 3 : 4);
  assert.throws(() =>
    run({
      epoch: g.epoch,
      action: { Move: { target: { q: 0, r: 1 }, cost: 0 } },
    }),
  );
  assert.deepEqual(run({}), g);
  const replay = [];
  for (let step = 0; step < 3500 && !g.state.gameEnded; step++) {
    const names = [
      "RetireTactic",
      "AnnounceEndOfRound",
      "EndTurn",
      "EndRest",
      "SelectTactic",
      "DeclareRest",
      "Rest",
      "PlayCardSideways",
      "PlayCardBasic",
    ];
    const choices = g.actions.filter((a) => kind(a) !== "Undo");
    const action =
      names.map((n) => choices.find((a) => kind(a) === n)).find(Boolean) ||
      choices[0];
    assert(action, scenario + " stuck in " + g.state.roundPhase);
    if (kind(action) === "RetireTactic") retired++;
    replay.push(action);
    g = run({ action, epoch: g.epoch });
  }
  assert(g.state.gameEnded, scenario + " did not end");
  assert.equal(g.state.round, scenario.startsWith("blitz") ? 4 : 6);
  assert.equal(g.score.player_results[0].outcome, "defeat");
  if (seats > 1) assert.equal(retired, g.state.round - 2);
  const final = g;
  g = run(init);
  for (const action of replay) g = run({ action, epoch: g.epoch });
  assert.deepEqual(final, g);
  console.log("PASS", scenario, replay.length, "actions, replay and scoring");
}
