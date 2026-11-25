import { picture, pieceId, faceURL } from "./artwork.js";
import { engine } from "./engine.mjs";
const app = document.querySelector("#app"),
  dialog = document.querySelector("dialog"),
  article = dialog.querySelector("article");
const heroes = [
  "arythea",
  "tovak",
  "goldyx",
  "norowas",
  "wolfhawk",
  "krang",
  "braevalar",
];
const key = "mage-knight-atlas.v1";
let command,
  game,
  journal,
  tab = "Orders",
  notice = "";
const name = (s) =>
  String(s ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
const esc = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const describe = (v) =>
  v == null
    ? ""
    : Array.isArray(v)
      ? v.map(describe).join(" · ")
      : typeof v === "object"
        ? Object.entries(v)
            .filter(([k]) => k !== "type")
            .map(([k, x]) =>
              typeof x === "object" ? describe(x) : name(k) + " " + name(x),
            )
            .join(", ")
        : name(v);
function effect(v) {
  if (!v) return "";
  if (v.options) return v.options.map(effect).join(" or ");
  if (v.effects) return v.effects.map(effect).join(" + ");
  return name(v.type).replace(/^Gain /, "") + " " + describe(v);
}
const pair = (a) => (typeof a === "string" ? [a, {}] : Object.entries(a)[0]);
const label = (a, p) => {
  const [k, v] = pair(a);
  if (k === "ResolveChoice" && p.pending?.options?.[v.choice_index])
    return p.pending.options[v.choice_index];
  if (k === "LearnStartingSkill") return "Learn " + name(v.skill);
  if (k === "PrepareExpedition")
    return (
      name(v.item === "supply" ? v.crystal + " crystal" : v.item) +
      " · " +
      (v.influence ? v.influence + " influence" : "free") +
      (v.crystal && v.kind !== "crystal" ? " + " + v.crystal + " crystal" : "")
    );
  if (k === "SelectTactic") return name(v.tactic_id);
  if (k.startsWith("PlayCard"))
    return (
      name(k.slice(8)) +
      (v.sideways_as ? " · " + name(v.sideways_as) : "") +
      (v.mana_color ? " · " + name(v.mana_color) + " mana" : "")
    );
  return name(k) + " " + describe(v);
};
const button = (id, text, cls = "") =>
  '<button class="' +
  cls +
  '" data-action="' +
  id +
  '">' +
  esc(text) +
  "</button>";
function modal(html) {
  article.innerHTML = html;
  if (!dialog.open) dialog.showModal();
}
document.querySelector("#close").onclick = () => dialog.close();
document.querySelector("#books").onclick = () =>
  modal(
    "<h2>Field library</h2>" +
      ["Walkthrough", "Rule-Book", "Expansion-Rule-Books"]
        .map(
          (n) =>
            '<p><a target="_blank" rel="noopener" href="https://www.mageknight.net/wp-content/uploads/Mage-Knight-Board-Game-Ultimate-Edition-' +
            n +
            '-September-2018.pdf">' +
            n.replaceAll("-", " ") +
            " ↗</a></p>",
        )
        .join(""),
  );
function setup() {
  app.innerHTML =
    "<small>Atlantean Empire</small><h1>Choose an expedition</h1><p>Lead a Mage Knight through the frontier. Explore new terrain, recruit allies and build your deck.</p>" +
    (game
      ? button(
          "resume",
          "Resume " + name(game.state.players[game.player].hero),
          "primary",
        )
      : "") +
    '<p><a href="table.html">Open Ultimate Edition tabletop →</a></p><section class="setup"><h2>New expedition</h2><label>Players<select id="count">' +
    [1, 2, 3, 4]
      .map(
        (n) =>
          '<option value="' +
          n +
          '">' +
          (n === 1 ? "Solo" : n + " · pass and play") +
          "</option>",
      )
      .join("") +
    '</select></label><label>Scenario<select id="scenario"></select></label><div id="seats"></div>' +
    button("start", "Begin expedition", "primary") +
    "</section>";
  const seats = () => {
    const n = Number(document.querySelector("#count").value);
    document.querySelector("#scenario").innerHTML = (
      n === 1
        ? [
            ["solo", "First Reconnaissance"],
            ["solo_conquest", "Solo Conquest"],
            ["lost_relic_solo", "The Lost Relic"],
          ]
        : [
            "first_reconnaissance",
            "full_conquest",
            "blitz_conquest",
            "mines_liberation",
            "druid_nights",
            "dungeon_lords",
            ...(n <= 3 ? ["full_cooperation", "blitz_cooperation"] : []),
          ].map((s) => [s + "_" + n + "p", name(s)])
    )
      .map(([k, t]) => '<option value="' + k + '">' + t + "</option>")
      .join("");
    document.querySelector("#seats").innerHTML = Array.from(
      { length: n },
      (_, i) =>
        "<label>Hero " +
        (i + 1) +
        '<select class="hero">' +
        heroes
          .map(
            (h, j) =>
              "<option " +
              (i === j ? "selected " : "") +
              'value="' +
              h +
              '">' +
              name(h) +
              "</option>",
          )
          .join("") +
        "</select></label>",
    ).join("");
  };
  document.querySelector("#count").onchange = seats;
  seats();
}
function persist() {
  try {
    localStorage.setItem(key, JSON.stringify(journal));
    notice = "Saved on this device";
  } catch {
    notice = "Device storage unavailable — keep this window open";
  }
}
function start() {
  const chosen = [...document.querySelectorAll(".hero")].map((n) => n.value);
  if (new Set(chosen).size !== chosen.length)
    return modal("<p>Choose a different hero for each seat.</p>");
  if (game && !confirm("Replace the expedition saved on this device?")) return;
  const init = {
    setupVersion: 4,
    seed: crypto.getRandomValues(new Uint32Array(1))[0],
    heroes: chosen,
    scenario: document.querySelector("#scenario").value,
  };
  game = command(init);
  journal = { init, steps: [] };
  tab = "Orders";
  persist();
  render();
}
const terrain = {
  plains: "#8b9857",
  hills: "#a28d54",
  forest: "#45694b",
  mountain: "#777b73",
  lake: "#497889",
  desert: "#bc9868",
  swamp: "#616f55",
  wasteland: "#956b54",
};
function map(s, p) {
  const cells = Object.values(s.map.hexes).map((h) => ({
    ...h,
    x: 34.64 * (h.coord.q + h.coord.r / 2),
    y: 30 * h.coord.r,
  }));
  const xs = cells.map((h) => h.x),
    ys = cells.map((h) => h.y),
    minX = Math.min(...xs) - 25,
    minY = Math.min(...ys) - 25;
  return (
    '<svg class="map" aria-label="Explored map" viewBox="' +
    [minX, minY, Math.max(...xs) - minX + 25, Math.max(...ys) - minY + 25].join(
      " ",
    ) +
    '">' +
    (s.map.tiles || [])
      .map((t) => {
        const face = faceURL(pieceId(t.tileId));
        if (!face) return "";
        const c = t.centerCoord,
          x = 34.64 * (c.q + c.r / 2),
          y = 30 * c.r;
        return (
          '<image x="' +
          (x - 51.96) +
          '" y="' +
          (y - 50) +
          '" width="103.92" height="100" preserveAspectRatio="none" href="' +
          esc(face) +
          '"/>'
        );
      })
      .join("") +
    cells
      .map((h) => {
        const key = h.coord.q + "," + h.coord.r,
          here = p.position?.q === h.coord.q && p.position?.r === h.coord.r;
        return (
          '<g tabindex="0" role="button" aria-label="' +
          esc(h.terrain + " " + key) +
          '" data-hex="' +
          key +
          '" transform="translate(' +
          h.x +
          " " +
          h.y +
          ')"><polygon class="' +
          (here ? "here" : "") +
          '" fill="' +
          (terrain[h.terrain] || "#767957") +
          '" fill-opacity="0.20" points="0,-20 17.32,-10 17.32,10 0,20 -17.32,10 -17.32,-10"/><text y="-1">' +
          (here ? "★ " : h.enemies.length ? "⚔ " : "") +
          esc(
            game.relic?.ruins.includes(key)
              ? "Ruined city"
              : name(h.site?.siteType || h.terrain).slice(0, 10),
          ) +
          '</text><text y="7">' +
          key +
          "</text></g>"
        );
      })
      .join("") +
    "</svg>"
  );
}
function orders(filter) {
  const p = game.state.players[game.player];
  return (
    '<div class="actions">' +
    game.actions
      .map((a, i) =>
        filter(...pair(a))
          ? (a.SelectTactic
              ? picture(
                  (game.state.timeOfDay === "day" ? "Day" : "Night") +
                    " Tactic " +
                    (1 +
                      (game.state.timeOfDay === "day"
                        ? [
                            "early_bird",
                            "rethink",
                            "mana_steal",
                            "planning",
                            "great_start",
                            "the_right_moment",
                          ]
                        : [
                            "from_the_dusk",
                            "long_night",
                            "mana_search",
                            "midnight_meditation",
                            "preparation",
                            "sparing_power",
                          ]
                      ).indexOf(a.SelectTactic.tactic_id)),
                )
              : picture(
                  a.PrepareExpedition?.item || a.LearnStartingSkill?.skill,
                )) + button("act-" + i, label(a, p))
          : "",
      )
      .join("") +
    "</div>"
  );
}
function info(value) {
  if (value == null) return "—";
  if (Array.isArray(value))
    return value.length ? value.map(info).join("<br>") : "—";
  if (typeof value !== "object")
    return (typeof value === "string" ? picture(value) : "") + esc(name(value));
  return (
    "<dl>" +
    Object.entries(value)
      .map(([k, v]) => "<dt>" + esc(name(k)) + "</dt><dd>" + info(v) + "</dd>")
      .join("") +
    "</dl>"
  );
}
function render() {
  const s = game.state,
    p = s.players[game.player],
    title =
      journal.init.scenario === "solo"
        ? "First Reconnaissance"
        : name(journal.init.scenario.replace(/_\dp$/, ""));
  app.innerHTML =
    "<small>" +
    esc(title) +
    " · " +
    name(s.timeOfDay) +
    " " +
    s.round +
    " / " +
    s.totalRounds +
    "</small><h1>" +
    picture(name(p.hero) + " Turn Order Token", "portrait") +
    esc(name(p.hero)) +
    '</h1><div class="stats"><b>Fame ' +
    p.fame +
    "</b><span>Level " +
    p.level +
    "</span><span>Armor " +
    p.armor +
    "</span><span>Reputation " +
    p.reputation +
    "</span></div>" +
    map(s, p) +
    "<nav>" +
    ["Orders", "Hand", "Company", "Chronicle"]
      .map((t) => button(t, t, t === tab ? "active" : ""))
      .join("") +
    '</nav><section id="panel"></section>';
  const panel = document.querySelector("#panel");
  if (s.gameEnded)
    panel.innerHTML =
      "<h2>Expedition ended</h2>" +
      s.players
        .map((h) => "<p>" + name(h.hero) + " · " + h.fame + " fame</p>")
        .join("");
  if (game.relic)
    panel.innerHTML +=
      "<p>" +
      (game.relic.influence != null
        ? game.relic.influence + " influence available for preparation"
        : "Relic pieces recovered · " + game.relic.collected + " / 2") +
      "</p>";
  if (s.gameEnded && game.score)
    panel.innerHTML +=
      "<h3>Final scoring</h3>" +
      info(game.score.player_results || game.score.playerResults);
  if (tab === "Orders")
    panel.innerHTML +=
      "<h2>" +
      esc(
        (game.relic?.influence != null ? "Prepare your expedition" : "") ||
          p.pending?.label ||
          (s.combat
            ? name(s.combat.phase)
            : s.roundPhase === "tactics_selection"
              ? "Choose your tactic"
              : "Field orders"),
      ) +
      '</h2><div class="stats">Move ' +
      p.movePoints +
      " · Influence " +
      p.influencePoints +
      " · Healing " +
      p.healingPoints +
      "</div><p>Source · " +
      s.source.dice
        .map(
          (d) =>
            picture(name(d.color) + " Mana") +
            name(d.color) +
            (d.isDepleted ? " (spent)" : ""),
        )
        .join(" / ") +
      "</p>" +
      (s.combat
        ? "<details open><summary>Enemy forces</summary>" +
          info(s.combat.enemies) +
          "</details>"
        : "") +
      orders((k) => !k.startsWith("PlayCard")) +
      button("Hand", "Play a card");
  if (tab === "Hand")
    panel.innerHTML +=
      "<h2>Deed hand</h2><p>" +
      p.deckCount +
      " in deck · " +
      p.discardCount +
      ' discarded</p><div class="hand">' +
      p.hand
        .map((id, i) => {
          const c = game.cards[id];
          return (
            '<button data-action="card-' +
            i +
            '" class="card" style="--accent:' +
            ({
              red: "#994536",
              blue: "#456777",
              white: "#cdbf99",
              green: "#557650",
            }[c?.color] || "#866") +
            '">' +
            picture(c?.name || id, "card-face") +
            "<small>" +
            esc(c?.color || "Wound") +
            "</small>" +
            esc(c?.name || name(id)) +
            "<br><span>" +
            esc(effect(c?.basic)) +
            "</span></button>"
          );
        })
        .join("") +
      "</div>";
  if (tab === "Company")
    panel.innerHTML +=
      "<h2>Company</h2>" +
      Object.entries({
        Units: p.units,
        Skills: p.skills,
        Crystals: p.crystals,
        Mana: p.manaTokens,
        Tactic: p.selectedTactic,
        Offers: s.offers,
        Combat: p.combatAccumulator,
      })
        .map(
          ([k, v]) =>
            "<details><summary>" + k + "</summary>" + info(v) + "</details>",
        )
        .join("");
  if (tab === "Chronicle")
    panel.innerHTML +=
      "<h2>Expedition chronicle</h2><ol reversed>" +
      journal.steps
        .slice()
        .reverse()
        .map(
          (a) =>
            "<li>" +
            esc(name(pair(a)[0]) + " " + describe(pair(a)[1])) +
            "</li>",
        )
        .join("") +
      "</ol>";
  document.querySelector("#status").textContent = notice;
}
function act(i) {
  const action = game.actions[i],
    before = game.player;
  game = command({ action, epoch: game.epoch });
  journal.steps.push(action);
  persist();
  if (dialog.open) dialog.close();
  tab = "Orders";
  if (before !== game.player) {
    app.innerHTML =
      "<h1>Pass the phone</h1><p>Next seat · " +
      name(game.state.players[game.player].hero) +
      "</p>" +
      button("resume", "Reveal turn", "primary");
  } else render();
}
document.addEventListener("click", (e) => {
  try {
    const hex = e.target.closest("[data-hex]")?.dataset.hex;
    if (hex) {
      const h = game.state.map.hexes[hex];
      modal(
        "<h2>" +
          name(h.terrain) +
          "</h2>" +
          picture(h.tileId, "inspect") +
          info({ site: h.site, enemies: h.enemies }) +
          orders((k, v) =>
            [v.target, v.hex, v.target_center].some(
              (t) => t && t.q + "," + t.r === hex,
            ),
          ),
      );
      return;
    }
    const id = e.target.closest("[data-action]")?.dataset.action;
    if (!id) return;
    if (id === "start") start();
    else if (id === "resume") render();
    else if (id.startsWith("act-")) act(Number(id.slice(4)));
    else if (id.startsWith("card-")) {
      const i = Number(id.slice(5)),
        p = game.state.players[game.player],
        c = game.cards[p.hand[i]];
      modal(
        "<h2>" +
          esc(c?.name || name(p.hand[i])) +
          "</h2>" +
          picture(c?.name || p.hand[i], "inspect") +
          "<p>Basic · " +
          esc(effect(c?.basic)) +
          "</p><p>Powered · " +
          esc(effect(c?.powered)) +
          "</p>" +
          orders((k, v) => k.startsWith("PlayCard") && v.hand_index === i),
      );
    } else {
      tab = id;
      render();
    }
  } catch (error) {
    modal("<p>" + esc(error.message) + "</p>");
  }
});
document.querySelector("#menu").onclick = () => command && setup();
try {
  command = await engine(await (await fetch("./atlas.wasm")).arrayBuffer());
  const saved = localStorage.getItem(key);
  if (saved) {
    journal = JSON.parse(saved);
    game = command(journal.init);
    for (const action of journal.steps)
      game = command({ action, epoch: game.epoch });
    notice = "Expedition restored";
    render();
  } else setup();
} catch (error) {
  app.textContent = "Could not open this expedition. " + error.message;
}
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("./sw.js").catch(() => {});
