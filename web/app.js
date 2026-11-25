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
let showMapLabels = false;
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
function effect(v, summary) {
  if (!v) return "";
  if (v.options)
    return "Choose " + v.options.map((x) => effect(x)).join(" or ");
  if (v.effects) return v.effects.map((x) => effect(x)).join(" and ");
  const element =
    v.element && v.element !== "physical" ? name(v.element) + " " : "";
  const combat =
    v.combatType && v.combatType !== "melee" ? name(v.combatType) + " " : "";
  switch (v.type) {
    case "gain_move":
      return "Move " + v.amount;
    case "gain_influence":
      return "Influence " + v.amount;
    case "gain_attack":
      return combat + element + "Attack " + v.amount;
    case "gain_block":
      return element + "Block " + v.amount;
    case "gain_healing":
      return "Heal " + v.amount;
    case "draw_cards":
      return "Draw " + v.count + (v.count === 1 ? " card" : " cards");
    case "gain_mana":
      return "Gain " + v.amount + " " + v.color + " mana";
    case "gain_crystal":
      return "Gain a " + (v.color || "basic") + " crystal";
    case "discard_cost":
      return (
        "Discard " +
        v.count +
        (v.wounds_only
          ? " Wound"
          : v.filter_wounds
            ? " non-Wound card"
            : " card") +
        (v.count === 1 ? "" : "s") +
        " to use this effect. " +
        effect(v.then_effect)
      );
    default:
      return summary || "Read the printed effect on the enlarged card.";
  }
}
const pair = (a) => (typeof a === "string" ? [a, {}] : Object.entries(a)[0]);
const tactics = {
  day: [
    "early_bird",
    "rethink",
    "mana_steal",
    "planning",
    "great_start",
    "the_right_moment",
  ],
  night: [
    "from_the_dusk",
    "long_night",
    "mana_search",
    "midnight_meditation",
    "preparation",
    "sparing_power",
  ],
};
const tacticEffects = {
  early_bird: "Act first in the day.",
  rethink:
    "Exchange up to three cards from your hand, including Wounds, then shuffle the discarded cards back into your deck.",
  mana_steal:
    "Reserve a basic-color Source die. Spend its mana on a later turn this day.",
  planning:
    "End a turn with at least two cards in hand to draw one above your hand limit.",
  great_start: "Immediately draw two cards.",
  the_right_moment:
    "Once this day, take another turn immediately after yours, before the end of the round is announced.",
  from_the_dusk: "Act first at night.",
  long_night:
    "Once this night, refill an empty deck with up to three random cards from your discard pile.",
  mana_search:
    "Before using Source mana, reroll up to two dice once per turn. Choose depleted gold dice first.",
  midnight_meditation:
    "Once before a turn this night, shuffle up to five cards from your hand into your deck and draw that many.",
  preparation:
    "Search your deck for one card to put in your hand, then shuffle.",
  sparing_power:
    "Before a turn, tuck your top deed under this tactic or flip the tactic to take all tucked cards into your hand.",
};
const instructions = {
  EndTurn: "Finish this turn and refill your hand up to its current limit.",
  Undo: "Return to the previous reversible game state.",
  DeclareRest: "Spend the turn resting to discard Wounds from your hand.",
  AnnounceEndOfRound:
    "Start the end-of-round sequence. The remaining heroes get their final turns.",
  BeginInteraction:
    "Spend Influence at this location to recruit or purchase what it offers.",
  EnterSite: "Enter the adventure site on your hex and resolve its encounter.",
  EndCombatPhase: "Finish the current combat phase and advance the battle.",
  FinishPreparation:
    "Keep your purchases, shuffle your starting deck and deal your opening hand.",
  BurnMonastery:
    "Fight the monastery defender for an artifact. Burning the monastery costs reputation.",
  LiberateMine: "Fight the guards to claim this mine.",
  MarkGlade: "Place your shield on this glade and end your movement.",
  PerformIncantation: "Summon one enemy for each glade you have marked.",
  ResolveAttack: "Resolve the attack using your assigned attack points.",
  SubsetConfirm: "Apply your current selection.",
};
function choice(a, p) {
  const [k, v] = pair(a),
    c = game.cards[v.card_id],
    xy = (t) => t.q + ", " + t.r;
  const text = (title, detail = "", art = "") => ({ title, detail, art });
  const item = v.unit_id || v.advanced_action_id || v.card_id || v.skill_id;
  const cardName = (id) => game.cards[id]?.name || name(id);
  if (k === "SelectTactic" || k === "RetireTactic") {
    const period = Object.keys(tactics).find((t) =>
      tactics[t].includes(v.tactic_id),
    );
    const rank = period ? tactics[period].indexOf(v.tactic_id) + 1 : 0;
    return text(
      (k === "RetireTactic" ? "Retire " : "") + name(v.tactic_id),
      k === "RetireTactic"
        ? "Remove this tactic from future rounds."
        : "Initiative " + rank + " · " + tacticEffects[v.tactic_id],
      period ? name(period) + " Tactic " + rank : "",
    );
  }
  if (k === "LearnStartingSkill")
    return text(
      "Learn " + name(v.skill),
      "Keep this skill for the expedition.",
      v.skill,
    );
  if (k === "PrepareExpedition") {
    const cost =
      (v.influence ? v.influence + " influence" : "free") +
      (v.crystal && v.kind !== "crystal" ? " + " + v.crystal + " crystal" : "");
    return text(
      name(v.item === "supply" ? v.crystal + " crystal" : v.item) +
        " · " +
        cost,
      "Add to your starting " +
        ({ unit: "company", crystal: "supply" }[v.kind] || "deck") +
        ".",
      v.item === "supply" ? v.crystal + " Mana" : v.item,
    );
  }
  if (k === "PlayCardBasic")
    return text("Play basic effect", effect(c?.basic, c?.basicText));
  if (k === "PlayCardPowered")
    return text(
      "Play powered effect" +
        (v.mana_color ? " · " + v.mana_color + " mana" : ""),
      effect(c?.powered, c?.poweredText),
    );
  if (k === "PlayCardSideways")
    return text(
      "Play sideways · " + name(v.sideways_as) + " 1",
      "Use the card for one point of " +
        name(v.sideways_as).toLowerCase() +
        ".",
    );
  if (k === "RecruitUnit")
    return text(
      "Recruit " + name(item),
      "Pay " +
        v.influence_cost +
        " Influence to add this unit to your company.",
      item,
    );
  if (k === "BuySpell")
    return text(
      "Buy " + cardName(item),
      "Pay 7 Influence and one " + v.mana_color + " mana.",
      item,
    );
  if (k === "LearnAdvancedAction" || k === "BuyCityAdvancedAction")
    return text(
      "Learn " + cardName(item),
      "Spend 6 Influence to gain this advanced action.",
      item,
    );
  if (
    k === "SelectArtifact" ||
    k === "SelectReward" ||
    k === "ChooseLevelUpAdvancedAction"
  )
    return text(
      "Take " + cardName(item),
      "Claim this " +
        (k === "SelectArtifact" ? "artifact" : v.unit_id ? "unit" : "card") +
        " as your reward.",
      item,
    );
  if (k === "ChooseLevelUpSkill") {
    const data = p.pending?.levelUpData;
    const id = (
      v.from_common_pool ? data?.commonPoolSkills : data?.drawnSkills
    )?.[v.skill_index];
    if (id)
      return text(
        "Learn " + name(id),
        v.from_common_pool
          ? "Choose from the common skills."
          : "Choose one of your drawn skills.",
        id,
      );
  }
  if (k === "ResolveTacticDecision") {
    const d = v.data;
    if (d.type === "preparation") {
      const id = p.pending?.cardIds?.[d.deck_card_index];
      if (id)
        return text(
          "Take " + cardName(id),
          "Put this card into your hand, then shuffle your deck.",
          id,
        );
    }
    if (d.type === "mana_steal") {
      const die = game.state.source.dice[d.die_index];
      if (die)
        return text(
          "Reserve " + die.color + " mana",
          "Take this die for your tactic.",
          die.color + " Mana",
        );
    }
    if (d.type === "sparing_power_stash")
      return text(
        "Set aside the top deed",
        "Keep it face down under Sparing Power.",
      );
    if (d.type === "sparing_power_take")
      return text(
        "Take the stored deeds",
        "Flip Sparing Power and add the stored cards to your hand.",
      );
  }
  if (k === "ResolveDiscardForCrystal")
    return item
      ? text(
          "Discard " + cardName(item),
          "Use this card for the crystal effect.",
          item,
        )
      : text("Skip this discard");
  if (k === "ResolveDecompose" || k === "ResolveMaximalEffect") {
    const id = p.hand[v.hand_index];
    if (id)
      return text(
        "Throw away " + cardName(id),
        "Remove this card to resolve the effect.",
        id,
      );
  }
  if (k === "InteractSite")
    return text(
      "Buy " + v.healing + " Healing",
      "Use Influence at this site to gain healing points.",
    );
  if (
    k === "DeclareBlock" ||
    k === "AssignDamageToHero" ||
    k === "AssignDamageToUnit"
  ) {
    const enemies = game.state.combat?.enemies || [];
    const enemy =
      k === "DeclareBlock"
        ? enemies.find((e) => e.instanceId === v.enemy_instance_id)
        : enemies[v.enemy_index];
    if (enemy) {
      const unit = p.units?.find((u) => u.instanceId === v.unit_instance_id);
      return text(
        k === "DeclareBlock"
          ? "Block " + enemy.name
          : "Assign damage to " + (unit ? name(unit.unitId) : name(p.hero)),
        enemy.name + " · attack " + (v.attack_index + 1),
        enemy.enemyId,
      );
    }
  }
  if (k === "ActivateUnit") {
    const unit = p.units.find((u) => u.instanceId === v.unit_instance_id);
    const ability = game.unitAbilities?.[v.unit_instance_id]?.[v.ability_index];
    if (unit && ability)
      return text(
        name(unit.unitId) + " · " + ability.effect,
        ability.mana
          ? "Pay one " + ability.mana + " mana to activate this ability."
          : "Activate this unit ability.",
        unit.unitId,
      );
  }
  if (
    k === "SubsetSelect" &&
    ["rethink", "midnight_meditation"].includes(p.pending?.kind)
  ) {
    const id = p.hand[v.index];
    if (id)
      return text(
        (p.pending.selected?.includes(v.index) ? "Deselect " : "Select ") +
          cardName(id),
        "Choose the cards to exchange, then confirm your selection.",
        id,
      );
  }
  if (k === "ResolveMeditation" && v.place_on_top == null) {
    const id = p.pending?.cardIds?.[v.selection_index];
    if (id)
      return text(
        "Select " + cardName(id),
        "Choose this card from your discard pile.",
        id,
      );
  }
  if (k === "ResolveChoice" || k === "SubsetSelect") {
    const opt = p.pending?.options?.[v.choice_index ?? v.index];
    if (typeof opt === "string") return text(opt, "", pieceId(opt) ? opt : "");
  }
  if (k === "Move")
    return text(
      "Move to " +
        name(game.state.map.hexes[v.target.q + "," + v.target.r]?.terrain) +
        " · " +
        xy(v.target),
      "Spend " + v.cost + " Move.",
    );
  if (k === "Explore")
    return text(
      "Explore at " + xy(v.target_center),
      "Reveal the next map tile here.",
    );
  if (k === "ChallengeRampaging")
    return text(
      "Challenge enemy at " + xy(v.hex),
      "Start combat with the rampaging enemy.",
    );
  if (k === "UseSkill" && item)
    return text("Use " + name(item), "Resolve the printed skill effect.", item);
  return text(
    name(k) + (Object.keys(v).length ? " · " + describe(v) : ""),
    instructions[k] || "",
    item || "",
  );
}
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
            "lost_relic_cooperative",
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
    '<defs><clipPath id="tile-cut" clipPathUnits="objectBoundingBox"><polygon points="0,.4 .166667,.3 .166667,.1 .333333,0 .5,.1 .666667,0 .833333,.1 .833333,.3 1,.4 1,.6 .833333,.7 .833333,.9 .666667,1 .5,.9 .333333,1 .166667,.9 .166667,.7 0,.6"/></clipPath></defs>' +
    (s.map.tiles || [])
      .map((t) => {
        const face = faceURL(pieceId(t.tileId));
        if (!face) return "";
        const c = t.centerCoord,
          x = 34.64 * (c.q + c.r / 2),
          y = 30 * c.r;
        return (
          '<image clip-path="url(#tile-cut)" x="' +
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
          '" fill-opacity="' +
          (faceURL(pieceId(h.tileId)) ? "0" : "1") +
          '" points="0,-20 17.32,-10 17.32,10 0,20 -17.32,10 -17.32,-10"/>' +
          (showMapLabels
            ? '<text y="-1">' +
              esc(
                game.relic?.ruins.includes(key)
                  ? "Ruined city"
                  : name(h.site?.siteType || h.terrain),
              ) +
              '</text><text y="7">' +
              key +
              "</text>"
            : "") +
          (!showMapLabels && (here || h.enemies.length)
            ? '<text class="map-marker" y="3">' + (here ? "★" : "⚔") + "</text>"
            : "") +
          "</g>"
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
      .map((a, i) => {
        if (!filter(...pair(a))) return "";
        const { title, detail, art } = choice(a, p),
          face = art && picture(art, "choice-face");
        const select =
          '<button aria-label="' +
          esc(title) +
          '" data-action="act-' +
          i +
          '"><strong>' +
          esc(title) +
          "</strong>" +
          (detail
            ? '<span class="action-detail">' + esc(detail) + "</span>"
            : "") +
          "</button>";
        return face
          ? '<div class="art-choice"><button class="inspect-choice" aria-label="Inspect ' +
              esc(title) +
              ' artwork" data-action="inspect-' +
              i +
              '">' +
              face +
              "</button>" +
              select +
              "</div>"
          : select;
      })
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
    button(
      "map-labels",
      showMapLabels ? "Hide hex labels" : "Show hex labels",
      "map-toggle",
    ) +
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
        : "Relic pieces recovered · " +
          game.relic.collected +
          " / " +
          game.relic.goal) +
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
            esc(effect(c?.basic, c?.basicText)) +
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

        Combat: p.combatAccumulator,
      })
        .map(
          ([k, v]) =>
            "<details><summary>" + k + "</summary>" + info(v) + "</details>",
        )
        .join("");
  if (tab === "Company") {
    panel.innerHTML +=
      "<h2>Offers</h2>" +
      Object.entries(s.offers)
        .map(([group, ids]) => {
          if (!ids.length) return "";
          return (
            "<h3>" +
            esc(name(group)) +
            '</h3><div class="hand">' +
            ids
              .map(
                (id) =>
                  '<button class="card" data-offer="' +
                  esc(id) +
                  '">' +
                  picture(id, "card-face") +
                  esc(name(id)) +
                  "</button>",
              )
              .join("") +
            "</div>"
          );
        })
        .join("");
  }
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
document.addEventListener("keydown", (e) => {
  const hex = e.target.closest("[data-hex]");
  if (hex && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    hex.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
});
document.addEventListener("click", (e) => {
  try {
    const offer = e.target.closest("[data-offer]")?.dataset.offer;
    if (offer) {
      const matches = (k, v) =>
        !k.startsWith("PlayCard") &&
        [v.card_id, v.unit_id, v.advanced_action_id, v.item].includes(offer);
      const available = game.actions.some((a) => matches(...pair(a)));
      modal(
        "<h2>" +
          esc(name(offer)) +
          "</h2>" +
          picture(offer, "inspect") +
          (available
            ? orders(matches)
            : "<p>This offer is available to inspect. You have no legal action to take it here right now.</p>"),
      );
      return;
    }
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
    if (id === "map-labels") {
      showMapLabels = !showMapLabels;
      render();
    } else if (id.startsWith("inspect-")) {
      const i = Number(id.slice(8)),
        p = game.state.players[game.player],
        item = choice(game.actions[i], p);
      modal(
        "<h2>" +
          esc(item.title) +
          "</h2>" +
          picture(item.art, "inspect") +
          "<p>" +
          esc(item.detail) +
          "</p>" +
          button("act-" + i, item.title, "primary"),
      );
    } else if (id === "start") start();
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
          esc(effect(c?.basic, c?.basicText)) +
          "</p><p>Powered · " +
          esc(effect(c?.powered, c?.poweredText)) +
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
    if (new URLSearchParams(location.search).get("screen") === "expeditions")
      setup();
    else render();
  } else setup();
} catch (error) {
  app.textContent = "Could not open this expedition. " + error.message;
}
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("./sw.js").catch(() => {});
