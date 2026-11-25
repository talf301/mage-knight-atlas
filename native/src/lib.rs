mod conquest;
mod druid;
mod dungeons;
mod mines;
mod portal;
mod relic;
use mk_engine::{
    action_pipeline::apply_legal_action,
    client_state::to_client_state,
    legal_actions::enumerate_legal_actions_with_undo,
    setup::{create_multiplayer_game, create_solo_game},
    undo::UndoStack,
};
use mk_types::{enums::Hero, state::GameState};
use serde_json::{json, Value};
use std::cell::RefCell;
thread_local! {
    static BUFFER: RefCell<Vec<u8>> = RefCell::new(Vec::new());
    static RETIRE: RefCell<Vec<String>> = RefCell::new(Vec::new());
    static GAME: RefCell<Option<(GameState,UndoStack)>> = RefCell::new(None);
}
#[no_mangle]
pub extern "C" fn input(n: usize) -> *mut u8 {
    BUFFER.with_borrow_mut(|b| {
        b.resize(n, 0);
        b.as_mut_ptr()
    })
}
#[no_mangle]
pub extern "C" fn output() -> *const u8 {
    BUFFER.with_borrow(|b| b.as_ptr())
}
fn run(cmd: Value) -> Result<Value, String> {
    GAME.with_borrow_mut(|slot| process_command(slot, cmd))
}

fn process_command(slot: &mut Option<(GameState, UndoStack)>, cmd: Value) -> Result<Value, String> {
    if let Some(ids) = cmd.get("heroes") {
        let heroes: Vec<Hero> = serde_json::from_value(ids.clone()).map_err(|e| e.to_string())?;
        if heroes.is_empty() || heroes.len() > 4 {
            return Err("Choose one to four heroes".into());
        }
        let seed = cmd["seed"].as_u64().ok_or("Missing seed")? as u32;
        let id = cmd["scenario"].as_str().ok_or("Missing scenario")?;
        if heroes
            .iter()
            .enumerate()
            .any(|(i, h)| heroes[..i].contains(h))
        {
            return Err("Each seat needs a different hero".into());
        }
        let mut state = if id == "solo_conquest" && heroes.len() == 1 {
            conquest::solo(seed, heroes[0])
        } else if id.starts_with("lost_relic_") {
            relic::setup(seed, &heroes, id)?
        } else if id.starts_with("one_to_return_") {
            portal::setup(seed, &heroes, id)?
        } else if id.starts_with("dungeon_lords_") {
            let mut s = mines::setup(
                seed,
                &heroes,
                &id.replace("dungeon_lords", "mines_liberation"),
            )?;
            s.scenario_id = id.into();
            s
        } else if id.starts_with("druid_nights_") {
            let mut s = mines::setup(
                seed,
                &heroes,
                &id.replace("druid_nights", "mines_liberation"),
            )?;
            s.scenario_id = id.into();
            s
        } else if id.starts_with("mines_liberation_") {
            mines::setup(seed, &heroes, id)?
        } else if id.contains("_cooperation_") {
            conquest::cooperation(seed, &heroes, id)?
        } else if id == "solo" && heroes.len() == 1 {
            create_solo_game(seed, heroes[0])
        } else {
            if heroes.len() < 2 {
                return Err("This scenario requires multiple seats".into());
            }
            let config = mk_data::scenarios::get_scenario(id).ok_or("Unknown scenario")?;
            if !(config.min_players..=config.max_players).contains(&(heroes.len() as u32)) {
                return Err("Wrong seat count for scenario".into());
            }
            create_multiplayer_game(seed, &heroes, config, id)
        };
        // Old journals replay against their original single-tile setup.
        let version = cmd["setupVersion"].as_u64().unwrap_or(1);
        if version >= 3 {
            conquest::prepare_decks(&mut state)
        }
        if version >= 4 {
            conquest::printed_components(&mut state);
        }
        if dungeons::active(&state) {
            dungeons::deck(&mut state)
        }
        druid::reset();
        if druid::active(&state) {
            druid::deck(&mut state)
        }
        if mines::active(&state) {
            mines::deck(&mut state)
        }
        if relic::active(&state) {
            relic::draft(&mut state);
        }
        if version >= 2 && !relic::active(&state) {
            let shape = state.scenario_config.map_shape;
            if version >= 3 && shape != mk_types::enums::MapShape::Wedge {
                state.scenario_config.map_shape = mk_types::enums::MapShape::Open3;
            }
            mk_engine::setup::place_initial_tiles(&mut state);
            state.scenario_config.map_shape = shape;
        }
        if dungeons::active(&state) {
            dungeons::reveal(&mut state, 1)
        }
        if druid::active(&state) {
            druid::friendly_city(&mut state)
        }
        if mines::active(&state) {
            mines::reveal(&mut state)
        }
        RETIRE.with_borrow_mut(|v| v.clear());
        *slot = Some((state, UndoStack::new()));
    }
    let (s, undo) = slot.as_mut().ok_or("Start a game")?;
    let current = |s: &GameState| {
        if let Some(i) = relic::chooser(s) {
            return i;
        }
        let id = s
            .current_tactic_selector
            .as_ref()
            .or_else(|| s.turn_order.get(s.current_player_index as usize));
        s.players
            .iter()
            .position(|p| Some(&p.id) == id)
            .unwrap_or(0)
    };
    let mut events = vec![];
    if let Some(a) = cmd.get("action") {
        let i = current(s);
        let epoch = cmd["epoch"].as_u64().ok_or("Missing epoch")?;
        if epoch != s.action_epoch {
            return Err("Turn has changed".into());
        }
        let pending = RETIRE.with_borrow(|v| v.clone());
        if !relic::offers(s).is_empty() {
            relic::purchase(s, a, undo)?;
        } else if !pending.is_empty() {
            let choice = a
                .get("RetireTactic")
                .and_then(|v| v["tactic_id"].as_str())
                .ok_or("Choose a used tactic to retire")?;
            if !pending.iter().any(|t| t == choice) {
                return Err("That tactic was not used by a hero".into());
            }
            s.removed_tactics.push(choice.into());
            RETIRE.with_borrow_mut(|v| v.clear());
            s.action_epoch += 1;
        } else if a.get("PlaceEntrance").is_some() || a.get("TravelTunnel").is_some() {
            dungeons::apply(s, i, a, undo)?;
        } else if matches!(a.as_str(), Some("MarkGlade" | "PerformIncantation")) {
            druid::apply(s, i, a.as_str().unwrap(), undo)?;
        } else if a.as_str() == Some("LiberateMine") {
            mines::fight(s, i, undo)?;
        } else {
            let action = serde_json::from_value(a.clone()).map_err(|e| e.to_string())?;
            let legal = enumerate_legal_actions_with_undo(s, i, undo);
            if !druid::permitted(s, i, a) || !legal.actions.contains(&action) {
                return Err("That action is unavailable in the current position".into());
            }
            if dungeons::active(s) {
                if !dungeons::placement(s).is_empty() || !dungeons::permitted(s, i, a) {
                    return Err("Resolve the dungeon placement first".into());
                }
                if a.as_str() == Some("EnterSite") {
                    dungeons::before_entry(s, i)?;
                }
            }
            let battle_fame = s.combat.as_ref().map_or(0, |c| c.fame_gained);
            let round = s.round;
            let tile_count = s.map.tiles.len();
            let used: Vec<String> = s
                .players
                .iter()
                .filter_map(|p| p.selected_tactic.as_ref().map(|t| t.to_string()))
                .collect();
            let old_level = s.scenario_config.default_city_level;
            if let Some(level) = conquest::city_level(s, &action) {
                s.scenario_config.default_city_level = level;
            }
            let assault = conquest::ending_assault(s, &action);
            let origin = s.players[i].position;
            let relic_battle = if relic::active(s) {
                relic::ending(s, &action)
            } else {
                None
            };
            let battle_hex = s.combat.as_ref().and_then(|c| c.combat_hex_coord);
            let result = apply_legal_action(s, undo, i, &action, epoch);
            s.scenario_config.default_city_level = old_level;
            events = result.map_err(|e| format!("{e:?}"))?.events;
            if relic::active(s) {
                if s.map.tiles.len() > tile_count {
                    relic::reveal(s, tile_count, i)
                }
                if let mk_types::legal_action::LegalAction::Move { target, .. } = action {
                    relic::enter(s, i, target, origin)?;
                }
                if let Some(battle) = relic_battle {
                    relic::finish(s, i, battle);
                }
                relic::uncover_adjacent(s);
            }
            if portal::active(s) && round == 1 && s.round == 2 {
                portal::close(s);
            }
            if let Some(assault) = assault {
                conquest::finish_assault(s, i, assault)
            }
            if dungeons::active(s) {
                if s.map.tiles.len() > tile_count {
                    dungeons::reveal(s, tile_count)
                }
                if s.combat.is_none() {
                    if let Some(c) = battle_hex {
                        dungeons::replace_guard(s, c)
                    }
                }
                dungeons::after(s);
            }
            if druid::active(s) {
                if s.map.tiles.len() > tile_count {
                    druid::friendly_city(s)
                }
                druid::after(s, i, round, undo, battle_fame);
            }
            if mines::active(s) {
                if s.map.tiles.len() > tile_count {
                    mines::reveal(s)
                }
                mines::after(s, s.round > round);
            }
            if relic::active(s) && s.players.len() > 1 && s.round > round && !s.game_ended {
                conquest::prepare_tactics(s);
            }
            if conquest::cooperative(s) && s.round > round && !s.game_ended {
                conquest::prepare_tactics(s);
                if round + 2 <= s.scenario_config.total_rounds {
                    RETIRE.with_borrow_mut(|v| *v = used)
                }
            }
        }
    }
    let i = current(s);
    let p = &s.players[i];
    let legal = enumerate_legal_actions_with_undo(s, i, undo);
    let view = to_client_state(s, &p.id);
    let mut cards = serde_json::Map::new();
    for id in p.hand.iter().chain(&view.offers.advanced_actions).chain(&view.offers.spells) {
        if let Some(c) = mk_data::cards::get_card(id.as_str()) {
            let combat_only = |categories: &[mk_data::cards::CardCategory]| {
                !categories.is_empty() && categories.iter().all(|category| *category == mk_data::cards::CardCategory::Combat)
            };
            cards.insert(id.to_string(), json!({
                "name": c.name, "color": c.color, "basic": c.basic_effect, "powered": c.powered_effect,
                "basicText": c.basic_effect.describe(), "poweredText": c.powered_effect.describe(),
                "basicCombat": combat_only(c.basic_categories), "poweredCombat": combat_only(c.powered_categories),
                "powerColor": c.powered_by.primary_color()
            }));
        }
    }
    let mut offered_units = serde_json::Map::new();
    for id in &s.offers.units {
        if let Some(unit) = mk_data::units::get_unit(id.as_str()) {
            offered_units.insert(id.to_string(), json!({
                "level":unit.level, "cost":unit.influence_cost, "sites":unit.recruit_sites,
                "ability":unit.abilities.first().map(|slot| slot.ability.describe())
            }));
        }
    }
    let mut unit_abilities = serde_json::Map::new();
    for unit in &p.units {
        if let Some(def) = mk_data::units::get_unit(unit.unit_id.as_str()) {
            let abilities: Vec<_> = def
                .abilities
                .iter()
                .map(|slot| json!({"effect":slot.ability.describe(),"mana":slot.mana_cost}))
                .collect();
            unit_abilities.insert(unit.instance_id.to_string(), json!(abilities));
        }
    }
    let mut actions = RETIRE.with_borrow(|v| {
        if v.is_empty() {
            json!(legal.actions)
        } else {
            json!(v
                .iter()
                .map(|t| json!({"RetireTactic":{"tactic_id":t}}))
                .collect::<Vec<_>>())
        }
    });
    if dungeons::active(s) {
        let pending = dungeons::placement(s);
        if !pending.is_empty() {
            actions = json!(pending)
        } else {
            let all = actions.as_array_mut().unwrap();
            all.retain(|a| dungeons::permitted(s, i, a));
            all.extend(dungeons::tunnels(s, i));
        }
    }
    actions
        .as_array_mut()
        .unwrap()
        .retain(|a| druid::permitted(s, i, a));
    for a in druid::available(s, i) {
        actions.as_array_mut().unwrap().push(json!(a));
    }
    if mines::may_fight(s, i) {
        actions.as_array_mut().unwrap().push(json!("LiberateMine"));
    }
    let starting = relic::offers(s);
    if !starting.is_empty() {
        actions = json!(starting);
    }
    let mut score = if relic::active(s) {
        relic::score(s)
    } else if portal::active(s) {
        portal::outcome(s)
    } else {
        conquest::score(s)
    };
    if dungeons::active(s) && !score.is_null() {
        score = dungeons::score(s, score)
    }
    if mines::active(s) && !score.is_null() {
        score = mines::score(s, score)
    }
    Ok(
        json!({"relic":relic::view(s),"score":score,"state":view,"player":i,"actions":actions,"epoch":legal.epoch,"cards":cards,"offeredUnits":offered_units,"unitAbilities":unit_abilities,"events":events}),
    )
}
#[no_mangle]
pub extern "C" fn execute() -> usize {
    let result = BUFFER
        .with_borrow(|b| serde_json::from_slice(b))
        .map_err(|e| e.to_string())
        .and_then(run)
        .unwrap_or_else(|e| json!({"error":e}));
    BUFFER.with_borrow_mut(|b| {
        *b = serde_json::to_vec(&result).unwrap();
        b.len()
    })
}
