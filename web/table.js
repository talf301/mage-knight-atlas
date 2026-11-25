const root = document.querySelector("#table"),
  dlg = document.querySelector("dialog"),
  article = dlg.querySelector("article");
const catalog = await (await fetch("components.json")).json(),
  items = catalog.items;
const heroes = [
  "Arythea",
  "Tovak",
  "Goldyx",
  "Norowas",
  "Wolfhawk",
  "Krang",
  "Braevalar",
];
const scenarios = {
  "First Reconnaissance": 18,
  "Full Conquest": 19,
  "Blitz Conquest": 19,
  "Solo Conquest": 19,
  "Full Cooperation": 20,
  "Blitz Cooperation": 20,
  "Mines Liberation": 20,
  "Druid Nights": 21,
  "Dungeon Lords": 21,
  "Conquer and Hold": 22,
  "One to Return": 22,
  "Volkare’s Return": -12,
  "Volkare’s Quest": -15,
  "Life and Death": -22,
  "The Realm of the Dead": -24,
  "The Hidden Valley": -25,
  "The Lost Relic": -27,
};
const store = "mk.table.v1",
  esc = (s) =>
    String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll('"', "&quot;")
      .replaceAll(">", "&gt;");
const colors = ["Red", "Blue", "Green", "White", "Gold", "Black"];
let state = JSON.parse(localStorage.getItem(store) || "null"),
  previous,
  tab = "Map",
  selectedZone = "",
  held = null,
  position = [900, 750],
  callbacks = [],
  warning = "";
function btn(t, fn, cls = "") {
  let i = callbacks.push(fn) - 1;
  return (
    '<button class="' + cls + '" data-c="' + i + '">' + esc(t) + "</button>"
  );
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-c]");
  if (b) callbacks[+b.dataset.c]?.();
});
document.querySelector("#dismiss").onclick = () => dlg.close();
function modal(html) {
  article.innerHTML = html;
  if (!dlg.open) dlg.showModal();
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function edit(note, fn) {
  previous = JSON.stringify(state);
  fn();
  state.log.push(note);
  try {
    localStorage.setItem(store, JSON.stringify(state));
  } catch {
    warning = "Storage full. Leave this page open.";
  }
  if (dlg.open) dlg.close();
  render();
}
const rule = (sc) => {
  const page = scenarios[sc],
    book = page < 0 ? "Expansion-Rule-Books" : "Rule-Book";
  return (
    '<a href="https://www.mageknight.net/wp-content/uploads/Mage-Knight-Board-Game-Ultimate-Edition-' +
    book +
    "-September-2018.pdf#page=" +
    Math.abs(page) +
    '" target="_blank" rel="noopener">Scenario rules · p. ' +
    Math.abs(page) +
    " ↗</a>"
  );
};
function setup() {
  callbacks = [];
  root.innerHTML =
    '<small>Campaign setup</small><h1>Set the table</h1><p>Play with the physical-game rules. The table handles shuffling, draws and saves. Players resolve movement, combat, scenario setup and scoring.</p><div class="setup"><label>Scenario <select id="sc">' +
    Object.keys(scenarios)
      .map((s) => "<option>" + esc(s) + "</option>")
      .join("") +
    '</select></label><div id="reference"></div><label>Starting map <select id="shape"><option value="722590">A · wedge</option><option value="5d0bac">B · open</option></select></label><h3>Choose one to five knights</h3>' +
    heroes
      .map(
        (h, i) =>
          '<label><input type="checkbox" value="' +
          h +
          '" ' +
          (!i ? "checked" : "") +
          "> " +
          h +
          "</label>",
      )
      .join("") +
    btn("Lay out components", start, "primary") +
    "</div>" +
    (state ? btn("Return to current table", render) : "");
  const sc = document.querySelector("#sc");
  sc.onchange = () =>
    (document.querySelector("#reference").innerHTML = rule(sc.value));
  sc.onchange();
}
function start() {
  const party = [...root.querySelectorAll("input:checked")].map((e) => e.value);
  if (!party.length || party.length > 5)
    return modal("Choose one to five heroes.");
  if (state && !confirm("Replace the current tabletop save?")) return;
  const piles = Object.fromEntries(
    Object.entries(catalog.piles).map(([k, a]) => [k, shuffle([...a])]),
  );
  const sc = document.querySelector("#sc").value;
  state = {
    sc,
    party,
    seat: 0,
    round: 1,
    piles,
    board: [],
    dice: [],
    stats: {},
    log: [],
    notes: "",
    ended: false,
  };
  for (const h of party) {
    piles[h + " deck"] = piles[h + " (Components) / Deeds"].splice(0);
    piles[h + " hand"] = piles[h + " deck"].splice(-5);
    piles[h + " discard"] = [];
    piles[h + " played"] = [];
    piles[h + " units"] = [];
    state.stats[h] = {
      Fame: 0,
      Reputation: 0,
      Armor: 2,
      Level: 1,
      Move: 0,
      Influence: 0,
      Attack: 0,
      Block: 0,
      Red: 0,
      Blue: 0,
      Green: 0,
      White: 0,
    };
    state.board.push({ marker: h, x: 900, y: 750 });
  }
  for (const z of [
    "Offer · units",
    "Offer · spells",
    "Offer · actions",
    "Map stack",
    "Removed",
    "Dummy deck",
    "Dummy discard",
  ])
    piles[z] = [];
  for (const [src, dst, n] of [
    ["Regular Units", "Offer · units", party.length + 2],
    ["Spells", "Offer · spells", 3],
    ["Advanced Actions", "Offer · actions", 3],
  ])
    piles[dst] = piles[src].splice(-n);
  do {
    state.dice = Array.from({ length: party.length + 2 }, die);
  } while (
    state.dice.filter((d) => !["Black", "Gold"].includes(d)).length <
    state.dice.length / 2
  );
  let tile = document.querySelector("#shape").value;
  for (const a of Object.values(piles)) {
    const i = a.indexOf(tile);
    if (i >= 0) a.splice(i, 1);
  }
  if (tile) state.board.unshift({ id: tile, x: 900, y: 750 });
  tab = "Map";
  edit("Table opened", () => {});
  previous = null;
}
function mapSetup() {
  const s = state.sc,
    n = state.party.length;
  const counts = {
    "Volkare’s Return": [[7, 8, 10, 12][n - 1] || 12, n, 1],
    "Volkare’s Quest": [
      [8, 9, 11, 12][n - 1] || 12,
      [4, 3, 4, 3][n - 1] || 3,
      [2, 2, 3, 3][n - 1] || 3,
    ],
    "Solo Conquest": [7, 2, 2],
    "First Reconnaissance": [n < 3 ? 8 : n === 3 ? 9 : 11, 2, 1],
    "Life and Death": [n === 1 ? 6 : 2 * n + 3, n === 1 ? 2 : n, 3],
    "The Hidden Valley": [n === 1 ? 5 : 2 * n + 1, Math.max(1, n), 2],
    "The Realm of the Dead": [n === 1 ? 5 : 2 * n + 1, Math.max(1, n), 2],
    "The Lost Relic": [n === 1 ? 6 : n + 4, Math.max(1, n - 1), Math.max(2, n)],
  };
  return (
    counts[s] || [
      n < 3 ? 8 : n === 3 ? 9 : 11,
      Math.max(1, n - 1),
      Math.max(1, n),
    ]
  );
}
function prepareMap() {
  const groups = [
    "Countryside Terrain Tiles",
    "Core Terrain Tiles",
    "City Terrain Tiles",
  ];
  const counts = mapSetup();
  modal(
    "<h2>Build the map stack</h2><p>Adjust the counts and set aside any specific tiles required by your scenario. The countryside goes on top.</p>" +
      rule(state.sc) +
      groups
        .map(
          (g, i) =>
            "<label>" +
            g +
            ' <input class="count" type="number" min="0" max="' +
            state.piles[g].length +
            '" value="' +
            Math.min(counts[i], state.piles[g].length) +
            '"></label>',
        )
        .join("") +
      btn("Build stack", () => {
        const nums = [...document.querySelectorAll(".count")].map((e) =>
          Number(e.value),
        );
        if (
          nums.some(
            (n, i) =>
              !Number.isInteger(n) ||
              n < 0 ||
              n > state.piles[groups[i]].length,
          )
        )
          return;
        edit("Prepared map stack", () => {
          const [country, core, city] = groups.map((g, i) =>
            nums[i] ? state.piles[g].splice(-nums[i]) : [],
          );
          let lower =
            state.sc === "Volkare’s Return"
              ? [...city, ...core]
              : shuffle([...city, ...core]);
          state.piles["Map stack"].push(...lower, ...country);
        });
      }),
  );
}
function die() {
  return colors[Math.floor(Math.random() * 6)];
}
function art(id) {
  const c = items[id];
  if (!c?.url) return "";
  const x = c.index % c.cols,
    y = Math.floor(c.index / c.cols);
  return (
    '<div role="img" aria-label="' +
    esc(c.name) +
    '" class="art ' +
    (c.cols * c.rows === 1 ? "token-art" : "") +
    '" style="background-image:url(&quot;' +
    esc(c.url) +
    "&quot;);background-size:" +
    100 * c.cols +
    "% " +
    100 * c.rows +
    "%;background-position:" +
    (c.cols > 1 ? (100 * x) / (c.cols - 1) : 0) +
    "% " +
    (c.rows > 1 ? (100 * y) / (c.rows - 1) : 0) +
    '%"></div>'
  );
}
const hero = () => state.party[state.seat];
function destinations() {
  const h = hero();
  return [
    h + " hand",
    h + " played",
    h + " discard",
    h + " deck",
    h + " units",
    "Map stack",
    "Removed",
    ...Object.keys(state.piles),
  ].filter((z, i, a) => a.indexOf(z) === i);
}
function transfer(source, index) {
  const onMap = source === null,
    arr = onMap ? state.board : state.piles[source],
    entry = arr[index],
    id = onMap ? entry.id : entry,
    title = entry?.marker || items[id]?.name;
  if (!title) return;
  if (onMap && entry.hidden) {
    modal(
      "<h2>Face-down piece</h2>" +
        btn("Reveal", () =>
          edit("Revealed piece", () => (entry.hidden = false)),
        ) +
        btn("Move", () => {
          dlg.close();
          held = { source, index };
          tab = "Map";
          render();
        }),
    );
    return;
  }
  function remove() {
    arr.splice(index, 1);
  }
  function dest(to, bottom = false) {
    edit(title + " → " + to, () => {
      remove();
      if (bottom) state.piles[to].unshift(id);
      else state.piles[to].push(id);
    });
  }
  modal(
    "<h2>" +
      esc(title) +
      "</h2>" +
      art(id) +
      (items[id]?.die
        ? btn("Roll die", () =>
            modal(
              "<h2>" +
                esc(
                  items[id].die[
                    Math.floor(Math.random() * items[id].die.length)
                  ],
                ) +
                "</h2>",
            ),
          )
        : "") +
      (onMap && id
        ? btn("Turn face down", () =>
            edit("Turned piece face down", () => (entry.hidden = true)),
          )
        : "") +
      (items[id]?.faces?.length
        ? btn("Switch face", () =>
            edit("Switched piece face", () => {
              const other = items[id].faces[0];
              if (onMap) entry.id = other;
              else arr[index] = other;
            }),
          )
        : "") +
      '<div class="row">' +
      btn("Place on map", () => {
        dlg.close();
        held = { source, index };
        tab = "Map";
        render();
      }) +
      (id
        ? btn("To hand", () => dest(hero() + " hand")) +
          btn("Play", () => dest(hero() + " played")) +
          btn("Discard", () => dest(hero() + " discard"))
        : "") +
      "</div>" +
      (id
        ? '<label>Destination pile <select id="dest">' +
          destinations()
            .map((z) => "<option>" + esc(z) + "</option>")
            .join("") +
          '</select></label><div class="row">' +
          btn("Put on top", () => dest(document.querySelector("#dest").value)) +
          btn("Put on bottom", () =>
            dest(document.querySelector("#dest").value, true),
          ) +
          btn("Copy piece", () =>
            edit("Copied " + title, () =>
              state.piles[hero() + " hand"].push(id),
            ),
          ) +
          "</div>"
        : ""),
  );
}
function moveAll(src, dst) {
  state.piles[dst].push(...state.piles[src].splice(0));
}
function draw() {
  const h = hero();
  edit(h + " drew a deed", () => {
    let id = state.piles[h + " deck"].pop();
    if (id) state.piles[h + " hand"].push(id);
  });
}
function pieces(z) {
  return (
    '<div class="spread">' +
    state.piles[z]
      .map((id, i) => btn(items[id]?.name || id, () => transfer(z, i)))
      .join("") +
    "</div>"
  );
}
function pile(z) {
  selectedZone = z;
  const a = state.piles[z];
  modal(
    "<h2>" +
      esc(z) +
      "</h2><p>" +
      a.length +
      ' pieces · top at the end of the list</p><div class="row">' +
      (a.length
        ? btn("Reveal top", () => transfer(z, a.length - 1)) +
          btn("Draw to hand", () =>
            edit("Drew from " + z, () =>
              state.piles[hero() + " hand"].push(a.pop()),
            ),
          ) +
          btn("Shuffle", () => edit("Shuffled " + z, () => shuffle(a))) +
          btn("Place face down", () => {
            dlg.close();
            held = { source: z, index: a.length - 1, hidden: true };
            tab = "Map";
            render();
          })
        : "") +
      "</div><details><summary>Search pile</summary>" +
      pieces(z) +
      '</details><label>Move top pieces to <select id="bulk">' +
      destinations()
        .filter((d) => d !== z)
        .map((d) => "<option>" + esc(d) + "</option>")
        .join("") +
      '</select></label><input id="qty" type="number" value="1" min="1" max="' +
      a.length +
      '">' +
      btn("Transfer", () => {
        const qty = Number(document.querySelector("#qty").value),
          dst = document.querySelector("#bulk").value;
        if (Number.isInteger(qty) && qty > 0 && qty <= a.length)
          edit("Transferred " + qty + " from " + z + " to " + dst, () =>
            state.piles[dst].push(...a.splice(-qty)),
          );
      }),
  );
}
function board() {
  return (
    "<p>" +
    (held
      ? "Tap the map at the destination."
      : "Tap a tile, token or knight to inspect or move it. Scroll the map in either direction.") +
    "</p>" +
    (held
      ? btn("Cancel placement", () => {
          held = null;
          render();
        })
      : "") +
    '<div class="board-scroll"><div class="board-space">' +
    state.board
      .map((p, i) => {
        const c = items[p.id],
          tile = c?.tile && !p.hidden;
        const text = p.hidden ? "Face down" : p.marker || c?.name || "Token";
        let k =
          callbacks.push(() => {
            if (!held) transfer(null, i);
          }) - 1;
        return (
          '<button class="' +
          (tile ? "tile" : p.marker ? "marker" : "piece") +
          '" style="left:' +
          p.x +
          "px;top:" +
          p.y +
          'px" data-c="' +
          k +
          '" aria-label="' +
          esc(text) +
          '">' +
          (tile
            ? '<img src="' + esc(c.url) + '" alt="' + esc(text) + '">'
            : esc(text)) +
          "</button>"
        );
      })
      .join("") +
    "</div></div>"
  );
}
function render() {
  callbacks = [];
  const h = hero();
  root.innerHTML =
    "<small>Round " +
    state.round +
    " · " +
    (state.round % 2 ? "Day" : "Night") +
    "</small><h1>" +
    esc(state.sc) +
    "</h1>" +
    rule(state.sc) +
    "<p>" +
    esc(h) +
    " · " +
    (state.ended ? "Expedition ended" : "Active seat") +
    '</p><nav class="toolbar">' +
    ["Map", "Hand", "Supply", "Tracks", "Journal"]
      .map((t) =>
        btn(
          t,
          () => {
            held = null;
            tab = t;
            render();
          },
          t === tab ? "active" : "",
        ),
      )
      .join("") +
    '</nav><section id="content"></section><p>' +
    esc(warning) +
    "</p>";
  const content = document.querySelector("#content");
  if (tab === "Map") {
    content.innerHTML =
      board() +
      btn("Pieces on map", () =>
        modal(
          "<h2>Pieces on map</h2>" +
            state.board
              .map((p, i) =>
                btn(p.hidden ? "Face down" : p.marker || items[p.id].name, () =>
                  transfer(null, i),
                ),
              )
              .join(""),
        ),
      ) +
      (state.piles["Map stack"].length
        ? btn("Explore · place next tile", () => {
            held = {
              source: "Map stack",
              index: state.piles["Map stack"].length - 1,
            };
            render();
          })
        : btn("Build map stack", prepareMap)) +
      btn("Add map marker", () => {
        const text = prompt("Marker label")?.trim();
        if (text)
          edit("Added marker", () =>
            state.board.push({ marker: text, x: position[0], y: position[1] }),
          );
      });
    const scroll = root.querySelector(".board-scroll");
    scroll.scrollLeft = position[0] - scroll.clientWidth / 2;
    scroll.scrollTop = position[1] - scroll.clientHeight / 2;
    scroll.onscroll = () =>
      (position = [
        scroll.scrollLeft + scroll.clientWidth / 2,
        scroll.scrollTop + scroll.clientHeight / 2,
      ]);
    root.querySelector(".board-space").onclick = (e) => {
      if (!held) return;
      e.stopPropagation();
      const r = e.currentTarget.getBoundingClientRect(),
        x = Math.round(e.clientX - r.left),
        y = Math.round(e.clientY - r.top);
      const { source, index, hidden = false } = held;
      held = null;
      edit("Placed piece", () => {
        if (source === null) Object.assign(state.board[index], { x, y });
        else
          state.board.push({
            id: state.piles[source].splice(index, 1)[0],
            x,
            y,
            hidden,
          });
      });
    };
  }
  if (tab === "Hand")
    content.innerHTML =
      "<h2>" +
      h +
      "’s hand</h2>" +
      pieces(h + " hand") +
      btn("Draw a deed · " + state.piles[h + " deck"].length, draw) +
      "<h3>Played</h3>" +
      pieces(h + " played") +
      "<h3>Company</h3>" +
      pieces(h + " units") +
      btn("End turn", () =>
        edit(h + " ended turn", () => {
          moveAll(h + " played", h + " discard");
          while (
            state.piles[h + " hand"].length <
              (state.stats[h]["Hand limit"] || 5) &&
            state.piles[h + " deck"].length
          )
            state.piles[h + " hand"].push(state.piles[h + " deck"].pop());
          for (const k of ["Move", "Attack", "Block", "Influence"])
            state.stats[h][k] = 0;
          state.seat = (state.seat + 1) % state.party.length;
          tab = "Map";
        }),
      );
  if (tab === "Supply") {
    content.innerHTML =
      '<h2>Component supply</h2><label>Find a pile <input id="filter" type="search" placeholder="Terrain, Volkare, skills…"></label><div class="piles"></div>' +
      btn("Create pile", () => {
        const z = prompt("Pile name")?.trim();
        if (
          z &&
          !Object.hasOwn(state.piles, z) &&
          !["__proto__", "prototype", "constructor"].includes(z)
        )
          edit("Created " + z, () => (state.piles[z] = []));
      });
    const list = () => {
      let q = document.querySelector("#filter").value.toLowerCase();
      content.querySelector(".piles").innerHTML = Object.keys(state.piles)
        .filter((z) => z.toLowerCase().includes(q))
        .map((z) => btn(z + " · " + state.piles[z].length, () => pile(z)))
        .join("");
    };
    document.querySelector("#filter").oninput = list;
    list();
  }
  if (tab === "Tracks")
    content.innerHTML =
      '<h2>Mana source</h2><div class="spread">' +
      state.dice
        .map((c, i) =>
          btn(c, () =>
            edit("Rolled source die", () => (state.dice[i] = die())),
          ),
        )
        .join("") +
      "</div><h2>" +
      h +
      "</h2>" +
      Object.entries(state.stats[h])
        .map(
          ([k, n]) =>
            '<div class="tally">' +
            btn("−", () => edit(k + " −1", () => state.stats[h][k]--)) +
            btn("+", () => edit(k + " +1", () => state.stats[h][k]++)) +
            "<b>" +
            esc(k) +
            "</b> " +
            n +
            "</div>",
        )
        .join("") +
      btn("Add tracker", () => {
        let k = prompt("Tracker name")?.trim();
        if (
          k &&
          !Object.hasOwn(state.stats[h], k) &&
          !["__proto__", "prototype", "constructor"].includes(k)
        )
          edit("Added tracker", () => (state.stats[h][k] = 0));
      });
  if (tab === "Journal")
    content.innerHTML =
      '<h2>Campaign journal</h2><label>Scenario notes and score <textarea id="notes">' +
      esc(state.notes) +
      "</textarea></label>" +
      btn("Save notes", () =>
        edit(
          "Updated notes",
          () => (state.notes = document.querySelector("#notes").value),
        ),
      ) +
      '<div class="row">' +
      btn("Next round", () => {
        if (confirm("Collect deeds and reshuffle for the next round?"))
          edit("New round", () => {
            state.round++;
            for (const p of state.party) {
              for (const z of ["played", "hand", "discard"])
                moveAll(p + " " + z, p + " deck");
              shuffle(state.piles[p + " deck"]);
              state.piles[p + " hand"] = state.piles[p + " deck"].splice(
                -(state.stats[p]["Hand limit"] || 5),
              );
            }
            do {
              state.dice = state.dice.map(die);
            } while (
              state.dice.filter((d) => !["Black", "Gold"].includes(d)).length <
              state.dice.length / 2
            );
          });
      }) +
      btn("Change seat", () =>
        edit(
          "Passed to next seat",
          () => (state.seat = (state.seat + 1) % state.party.length),
        ),
      ) +
      btn(state.ended ? "Resume expedition" : "Finish expedition", () =>
        edit("Changed expedition status", () => (state.ended = !state.ended)),
      ) +
      btn("New table", setup) +
      (previous
        ? btn("Undo last change", () => {
            state = JSON.parse(previous);
            previous = null;
            localStorage.setItem(store, JSON.stringify(state));
            render();
          })
        : "") +
      "</div><ol reversed>" +
      state.log
        .slice()
        .reverse()
        .map((x) => "<li>" + esc(x) + "</li>")
        .join("") +
      "</ol>";
}
if (state) render();
else setup();
