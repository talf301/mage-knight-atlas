use mk_data::{scenarios, tiles, unit_offers};
use mk_engine::setup::{create_solo_game, generate_tile_slots};
use mk_types::{
    enums::{Hero, SiteType},
    ids::ScenarioId,
    legal_action::LegalAction,
    state::GameState,
};
use serde_json::{json, Value};

pub fn solo(seed: u32, hero: Hero) -> GameState {
    let mut state = create_solo_game(seed, hero);
    let mut config = scenarios::full_conquest_2p();
    let training = scenarios::first_reconnaissance();
    config.min_players = 1;
    config.max_players = 1;
    config.countryside_tile_count = 7;
    config.core_tile_count = 2;
    config.city_tile_count = 2;
    config.default_city_level = 5;
    config.pvp_enabled = false;
    config.scoring_config = training.scoring_config;
    config.tactic_removal_mode = training.tactic_removal_mode;
    config.dummy_tactic_order = training.dummy_tactic_order;
    state.map.tile_deck = tiles::create_tile_deck(&config, &mut state.rng);
    state.map.tile_slots = generate_tile_slots(config.map_shape, 12);
    let (regular, elite, offer) =
        unit_offers::create_unit_deck_and_offer(&mut state.rng, 1, true, false);
    state.offers.units = offer;
    state.decks.unit_deck = regular;
    state.decks.elite_unit_deck = elite;
    let spells = &mut state.decks.spell_deck;
    spells.append(&mut state.offers.spells);
    spells.retain(|id| {
        !matches!(
            id.as_str(),
            "mana_meltdown" | "energy_flow" | "mind_read" | "mana_claim"
        )
    });
    state.rng.shuffle(spells);
    state.offers.spells = spells.drain(..3).collect();
    state.scenario_id = ScenarioId::from("solo_conquest");
    state.city_level = 5;
    state.scenario_config = config;
    state
}

// City difficulty follows discovery order, even if the second city is attacked first.
pub fn city_level(state: &GameState, action: &LegalAction) -> Option<u32> {
    if state.scenario_id.as_str() != "solo_conquest" && !cooperative(state) {
        return None;
    }
    let LegalAction::Move { target, .. } = action else {
        return None;
    };
    let h = state.map.hexes.get(&target.key())?;
    if h.site.as_ref()?.site_type != SiteType::City {
        return None;
    }
    let rank = state
        .map
        .tiles
        .iter()
        .filter(|t| tiles::is_city_tile(t.tile_id))
        .position(|t| t.tile_id == h.tile_id)?;
    Some(
        if state.scenario_id.as_str().starts_with("blitz_cooperation") {
            5 + 3 * rank as u32
        } else if rank + 1 == state.scenario_config.city_tile_count as usize {
            if state.players.len() == 3 {
                11
            } else {
                8
            }
        } else {
            5
        },
    )
}

pub fn score(state: &GameState) -> Value {
    let Some(result) = state.final_score_result.as_ref() else {
        return Value::Null;
    };
    let mut value = json!(result);
    if state.scenario_id.as_str() != "solo_conquest" && !cooperative(state) {
        return competitive_score(state, value);
    }
    let cities = state
        .map
        .hexes
        .values()
        .filter_map(|h| h.site.as_ref())
        .filter(|s| s.site_type == SiteType::City && s.is_conquered)
        .count() as i32;
    let won = cities as u32 == state.scenario_config.city_tile_count;
    let rounds = state
        .scenario_config
        .total_rounds
        .saturating_sub(state.round) as i32;
    let cards = state.dummy_player.as_ref().map_or(0, |d| d.deck.len()) as i32;
    let bonus = if state.end_of_round_announced_by.is_none() {
        5
    } else {
        0
    };
    let completed = if won { 15 } else { 0 };
    if cooperative(state) {
        let mut categories = std::collections::BTreeMap::new();
        for r in &result.player_results {
            if let Some(a) = &r.achievements {
                for c in &a.category_scores {
                    let n = categories.entry(c.category).or_insert(c.base_points);
                    if c.base_points < 0 {
                        *n = (*n).min(c.base_points)
                    } else if *n >= 0 {
                        *n = (*n).max(c.base_points)
                    }
                }
            }
        }
        let all_led = state.players.iter().all(|p| {
            state
                .map
                .hexes
                .values()
                .filter_map(|h| h.site.as_ref())
                .any(|s| {
                    s.site_type == SiteType::City
                        && s.is_conquered
                        && s.owner.as_ref() == Some(&p.id)
                })
        });
        let team = state
            .players
            .iter()
            .map(|p| p.fame as i32)
            .min()
            .unwrap_or(0)
            + categories.values().sum::<i32>()
            + cities * 10
            + completed
            + rounds * 30
            + cards
            + bonus
            + if all_led { 10 } else { 0 };
        value["player_results"] = json!([{"team_score":team,"outcome":if won{"victory"}else{"defeat"},"cities":cities,"all_heroes_led":all_led,"achievement_points":categories,"unused_rounds":rounds,"dummy_cards":cards}]);
        return value;
    }
    let p = &mut value["player_results"][0];
    p["module_results"] = json!({"cities":cities*10,"both_cities":completed,"unused_rounds":rounds*30,"dummy_cards":cards,"unannounced_round":bonus});
    p["total_score"] = json!(
        result.player_results[0].total_score
            + cities * 10
            + completed
            + rounds * 30
            + cards
            + bonus
    );
    p["outcome"] = json!(if won { "victory" } else { "defeat" });
    value
}

pub fn cooperative(state: &GameState) -> bool {
    state.scenario_id.as_str().contains("_cooperation_")
}

pub fn cooperation(seed: u32, heroes: &[Hero], id: &str) -> Result<GameState, String> {
    use mk_engine::dummy_player;
    use mk_types::enums::{DummyTacticOrder, MapShape, TacticRemovalMode};
    let n = heroes.len();
    if !(2..=3).contains(&n) {
        return Err("Cooperation requires two or three heroes".into());
    }
    let blitz = id == format!("blitz_cooperation_{n}p");
    if !blitz && id != format!("full_cooperation_{n}p") {
        return Err("Scenario does not match seats".into());
    }
    let mut c = if blitz {
        scenarios::blitz_conquest_2p()
    } else {
        scenarios::full_conquest_2p()
    };
    c.map_shape = MapShape::Open;
    c.countryside_tile_count = if blitz {
        5 + n as u32
    } else {
        4 + 2 * n as u32
    };
    c.city_tile_count = n as u32 + u32::from(!blitz);
    c.core_tile_count = n as u32 - u32::from(blitz);
    c.default_city_level = 5;
    c.pvp_enabled = false;
    c.dummy_tactic_order = DummyTacticOrder::BeforeHumans;
    c.tactic_removal_mode = TacticRemovalMode::VoteOne;
    c.scoring_config = scenarios::first_reconnaissance().scoring_config;
    let mut state = mk_engine::setup::create_multiplayer_game(seed, heroes, c, id);
    let dummy = dummy_player::select_dummy_hero(heroes, &mut state.rng);
    state.dummy_player = Some(dummy_player::create_dummy_player(dummy, &mut state.rng));
    state.turn_order.push(dummy_player::DUMMY_PLAYER_ID.into());
    let spells = &mut state.decks.spell_deck;
    spells.append(&mut state.offers.spells);
    spells.retain(|id| {
        !matches!(
            id.as_str(),
            "mana_meltdown" | "energy_flow" | "mind_read" | "mana_claim"
        )
    });
    state.rng.shuffle(spells);
    state.offers.spells = spells.drain(..3).collect();
    prepare_tactics(&mut state);
    Ok(state)
}
pub fn prepare_tactics(s: &mut GameState) {
    s.available_tactics
        .retain(|t| !s.removed_tactics.contains(t));
    if let Some(i) = s.rng.random_index(s.available_tactics.len()) {
        s.dummy_player_tactic = Some(s.available_tactics.remove(i));
    }
}

pub fn prepare_decks(s: &mut GameState) {
    use mk_types::enums::{MapShape, TileId};
    if s.scenario_config.map_shape != MapShape::Wedge {
        s.map.tiles[0].tile_id = TileId::StartingB;
        for def in tiles::STARTING_TILE_B {
            if let Some(h) = s.map.hexes.get_mut(&def.local.key()) {
                h.terrain = def.terrain;
                h.tile_id = TileId::StartingB;
            }
        }
    }
    if !s.scenario_id.as_str().starts_with("first_reconnaissance") {
        let mut countries = tiles::all_countryside_tiles();
        s.rng.shuffle(&mut countries);
        countries.truncate(s.scenario_config.countryside_tile_count as usize);
        s.map.tile_deck.countryside = countries;
        s.rng.shuffle(&mut s.map.tile_deck.core);
    }
    s.decks.artifact_deck = mk_data::cards::ARTIFACT_IDS
        .iter()
        .map(|&id| id.into())
        .collect();
    s.rng.shuffle(&mut s.decks.artifact_deck);
}

fn competitive_score(state: &GameState, mut value: Value) -> Value {
    let id = state.scenario_id.as_str();
    if !id.starts_with("blitz_conquest_") && !id.starts_with("full_conquest_") {
        return value;
    }
    let mut points = vec![0; state.players.len()];
    for h in state.map.hexes.values() {
        let Some(site) = h.site.as_ref() else {
            continue;
        };
        if site.site_type != SiteType::City || !site.is_conquered {
            continue;
        }
        for (i, p) in state.players.iter().enumerate() {
            if site.owner.as_ref() == Some(&p.id) {
                points[i] += 7
            } else if h.shield_tokens.contains(&p.id) {
                points[i] += 4
            }
        }
    }
    let best = *points.iter().max().unwrap_or(&0);
    let tied = points.iter().filter(|n| **n == best).count() > 1;
    let mut ranking = Vec::new();
    for (i, city_points) in points.iter().enumerate() {
        let title = if best > 0 && *city_points == best {
            if tied {
                2
            } else {
                5
            }
        } else {
            0
        };
        let p = &mut value["player_results"][i];
        let total = p["total_score"].as_i64().unwrap_or(0) + i64::from(city_points + title);
        p["module_results"] = json!({"city_points":city_points,"greatest_city_conqueror":title});
        p["total_score"] = json!(total);
        ranking.push((total, state.players[i].id.as_str()));
    }
    ranking.sort_by_key(|r| std::cmp::Reverse(r.0));
    value["rankings"] = json!(ranking.iter().map(|r| r.1).collect::<Vec<_>>());
    value["is_tied"] = json!(ranking.len() > 1 && ranking[0].0 == ranking[1].0);
    value
}
