# Mage Knight Campaign Atlas

An unofficial touch-first game for iPhone. Open the site in Safari, then use Share → Add to Home Screen. The game saves on the current device. The atlas and tabletop each keep one expedition.

## Playing

**Guided expeditions** run a Rust rules engine on the device. Choose First Reconnaissance solo or with two to four players. Solo Conquest also supports one hero. Pass-and-play adds Full Conquest, Blitz Conquest, Mines Liberation, Druid Nights and Dungeon Lords. Two or three heroes can play Full Cooperation or Blitz Cooperation. Guided coverage is partial. Player-versus-player combat, expansion bosses and the complete set of card interactions are unfinished. Select a tactic under Orders. Tap a deed under Hand to see its effects and available plays. Tap the map to inspect a hex. The Company tab contains units, skills, mana and offers.

**Ultimate Edition tabletop** supports one to five seats and seven knights, including Wolfhawk, Krang and Braevalar. Choose a scenario and use its linked setup and scoring rules. The table shuffles component piles, deals hands and offers, rolls mana and saves each move. Players referee special setup, combat, enemy behavior, rewards, victory and scores. Supply includes Volkare’s pieces and the two Tezla factions. The linked rulebooks require internet access. The service worker downloads the component faces for offline play.

1. Choose the map face and knights. In Map, build the tile stack or move specific tiles between piles under Supply. Explore places a tile where you tap. Set up the initial tiles and defenders from the scenario diagram.
2. Find pieces by pile name in Supply. Reveal, take, shuffle or transfer pieces to any pile. Place hidden garrisons directly from their pile. Use Search pile for effects that let you choose. Copy a piece for unlimited supplies such as wounds and shields.
3. Tap a knight and choose Place on map to move. Use Pieces on map to select overlapping pieces. Tap a deed to play or discard it. Tracks holds resources and allows custom counters. Use Journal to pass the phone, collect decks at round end, record scores and finish the game.
4. For dummy turns, transfer an unused hero’s deeds to Dummy deck and use the dummy-player procedure in the scenario book. Apply the scenario’s specific source, offer, tactic and hand-limit adjustments.

Design by Vlaada Chvátil. Mage Knight is published by WizKids. Engine dependency from [Mage Knight Digital](https://github.com/mage-knight-digital/MageKnight/tree/5fcb5e116ff61a25bf6fad75f179152e6f4b596d). Tabletop component references from [Mage Knight Plus](https://steamcommunity.com/sharedfiles/filedetails/?id=1721301081). The client links to the three September 2018 Ultimate Edition books. The catalog uses compact WebP images derived from workshop sheets and original mana crystal illustrations.

## Local development

Serve the web directory with a static HTTP server. Service workers require HTTPS or localhost. The compiled WebAssembly engine is included.

To rebuild, clone the engine at the revision above in a directory named game beside this checkout. Install the wasm32-unknown-unknown Rust target and run the following from this checkout.

```sh
cargo build --manifest-path native/Cargo.toml --locked --release --target wasm32-unknown-unknown
cp native/target/wasm32-unknown-unknown/release/atlas.wasm web/
node tests/engine.mjs
```

The mobile browser smoke test requires Playwright and its WebKit browser. Run `node tests/browser.cjs http://localhost:8000/web/` against the served checkout. It exercises both play modes, persistence, and offline guided play.
