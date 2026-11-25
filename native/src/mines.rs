use mk_data::{enemy_piles::draw_enemy_token, scenarios, tiles};
use mk_engine::{
    combat::{execute_enter_combat, EnterCombatOptions},
    setup::create_multiplayer_game,
    undo::UndoStack,
};
use mk_types::{
    enums::{EnemyColor, Hero, MapShape, RoundPhase, ScenarioEndTrigger, SiteType, TileId},
    state::{GameState, HexEnemy, PlayerFlags},
};
use serde_json::{json, Value};

pub fn setup(seed: u32, heroes: &[Hero], id: &str) -> Result<GameState, String> {
    let n = heroes.len();
    if !(2..=4).contains(&n) || id != format!("mines_liberation_{n}p") {
        return Err("Mines Liberation requires two to four heroes".into());
    }
    let mut c = scenarios::full_conquest_2p();
    c.total_rounds = 4;
    c.day_rounds = 2;
    c.night_rounds = 2;
    c.countryside_tile_count = [8, 9, 11][n - 2];
    c.city_tile_count = 1;
    c.core_tile_count = n as u32 - 1;
    c.map_shape = if n == 4 {
        MapShape::Open4
    } else {
        MapShape::Wedge
    };
    c.end_trigger = ScenarioEndTrigger::RoundLimit;
    Ok(create_multiplayer_game(seed, heroes, c, id))
}

pub fn active(s: &GameState) -> bool {
    s.scenario_id.as_str().starts_with("mines_liberation_")
}
fn has_mine(tile: TileId) -> bool {
    tiles::get_tile_hexes(tile)
        .unwrap()
        .iter()
        .any(|h| h.site_type == Some(SiteType::Mine))
}
pub fn deck(s: &mut GameState) {
    let (mut mandatory, mut optional): (Vec<_>, Vec<_>) = tiles::all_countryside_tiles()
        .into_iter()
        .partition(|&t| has_mine(t));
    s.rng.shuffle(&mut optional);
    mandatory.extend(
        optional
            .into_iter()
            .take(s.scenario_config.countryside_tile_count as usize - mandatory.len()),
    );
    s.rng.shuffle(&mut mandatory);
    s.map.tile_deck.countryside = mandatory;
    let mut core: Vec<_> = tiles::all_non_city_core_tiles()
        .into_iter()
        .filter(|&t| has_mine(t))
        .collect();
    s.rng.shuffle(&mut core);
    core.truncate(s.scenario_config.core_tile_count as usize);
    core.push(TileId::Core8RedCity);
    s.rng.shuffle(&mut core);
    s.map.tile_deck.core = core;
}

// Crystal production is gated by mine_color in the engine. Restore the printed
// colour only once the defenders have been removed.
pub fn reveal(s: &mut GameState) {
    for hex in s.map.hexes.values_mut() {
        let Some(site) = hex.site.as_mut() else {
            continue;
        };
        if site.site_type == SiteType::City && !site.is_conquered {
            site.is_conquered = true;
            hex.enemies.clear();
            hex.shield_tokens
                .extend(s.players.iter().map(|p| p.id.clone()));
        }
        if site.site_type != SiteType::Mine || site.is_conquered || site.mine_color.take().is_none()
        {
            continue;
        }
        let guard = if tiles::is_core_tile(hex.tile_id) {
            EnemyColor::Red
        } else {
            EnemyColor::Green
        };
        for color in [guard, EnemyColor::Brown] {
            if let Some(token_id) = draw_enemy_token(&mut s.enemy_tokens, color, &mut s.rng) {
                hex.enemies.push(HexEnemy {
                    token_id,
                    color,
                    is_revealed: color != EnemyColor::Brown,
                });
            }
        }
    }
}

pub fn may_fight(s: &GameState, i: usize) -> bool {
    let p = &s.players[i];
    active(s)
        && !s.game_ended
        && s.round_phase == RoundPhase::PlayerTurns
        && s.combat.is_none()
        && p.pending.is_empty()
        && !p.flags.intersects(
            PlayerFlags::HAS_TAKEN_ACTION_THIS_TURN
                | PlayerFlags::IS_RESTING
                | PlayerFlags::HAS_RESTED_THIS_TURN
                | PlayerFlags::IS_INTERACTING
                | PlayerFlags::KNOCKED_OUT,
        )
        && p.position
            .and_then(|c| s.map.hexes.get(&c.key()))
            .is_some_and(|h| {
                h.site
                    .as_ref()
                    .is_some_and(|site| site.site_type == SiteType::Mine && !site.is_conquered)
            })
}
pub fn fight(s: &mut GameState, i: usize, undo: &mut UndoStack) -> Result<(), String> {
    if !may_fight(s, i) {
        return Err("Cannot enter a mine now".into());
    }
    let c = s.players[i].position.unwrap();
    let hex = s.map.hexes.get_mut(&c.key()).unwrap();
    if !hex.enemies.iter().any(|e| e.color == EnemyColor::Brown)
        && hex.enemies.len() == 1
        && !hex.enemies[0].is_revealed
    {
        return Err("No defender available".into());
    }
    let ids: Vec<_> = hex.enemies.iter().map(|e| e.token_id.clone()).collect();
    execute_enter_combat(
        s,
        i,
        &ids,
        false,
        Some(c),
        EnterCombatOptions {
            units_allowed: true,
            night_mana_rules: true,
        },
    )
    .map_err(|e| format!("{e:?}"))?;
    for e in &mut s.map.hexes.get_mut(&c.key()).unwrap().enemies {
        e.is_revealed = true
    }
    s.players[i]
        .flags
        .insert(PlayerFlags::HAS_TAKEN_ACTION_THIS_TURN | PlayerFlags::HAS_COMBATTED_THIS_TURN);
    undo.set_checkpoint();
    s.action_epoch += 1;
    Ok(())
}
pub fn after(s: &mut GameState, new_round: bool) {
    let mut captured = false;
    for h in s.map.hexes.values_mut() {
        let Some(site) = h.site.as_mut() else {
            continue;
        };
        if site.site_type != SiteType::Mine || !site.is_conquered {
            continue;
        }
        let Some(owner) = s
            .players
            .iter_mut()
            .find(|p| Some(&p.id) == site.owner.as_ref())
        else {
            continue;
        };
        if site.mine_color.is_none() {
            let center = s
                .map
                .tiles
                .iter()
                .find(|t| t.tile_id == h.tile_id)
                .unwrap()
                .center_coord;
            site.mine_color = tiles::get_tile_hexes(h.tile_id)
                .unwrap()
                .iter()
                .find(|d| d.local.q + center.q == h.coord.q && d.local.r + center.r == h.coord.r)
                .and_then(|d| d.mine_color);
            owner.reputation =
                (owner.reputation + if tiles::is_core_tile(h.tile_id) { 2 } else { 1 }).min(7);
            captured = true;
        }
        if new_round {
            if let Some(color) = site.mine_color {
                mk_engine::mana::gain_crystal(owner, color);
            }
        }
    }
    if captured || !s.scenario_end_triggered {
        let clear = s.map.tile_deck.countryside.is_empty()
            && s.map.tile_deck.core.is_empty()
            && s.map
                .hexes
                .values()
                .filter_map(|h| h.site.as_ref())
                .all(|t| t.site_type != SiteType::Mine || t.is_conquered);
        if clear && !s.scenario_end_triggered {
            s.scenario_end_triggered = true;
            s.final_turns_remaining = Some(s.players.len() as u32 + 1);
        }
    }
}
pub fn score(s: &GameState, mut value: Value) -> Value {
    let mut points = vec![0i32; s.players.len()];
    for h in s.map.hexes.values() {
        let Some(site) = h.site.as_ref() else {
            continue;
        };
        if site.site_type != SiteType::Mine || !site.is_conquered {
            continue;
        }
        if let Some(i) = s
            .players
            .iter()
            .position(|p| Some(&p.id) == site.owner.as_ref())
        {
            points[i] += if tiles::is_core_tile(h.tile_id) { 7 } else { 4 }
        }
    }
    let best = points.iter().copied().max().unwrap_or(0);
    let winners = points.iter().filter(|v| **v == best).count();
    let mut ranks = vec![];
    for (i, points) in points.into_iter().enumerate() {
        let p = &mut value["player_results"][i];
        let bonus = if best > 0 && points == best {
            if winners > 1 {
                2
            } else {
                5
            }
        } else {
            0
        };
        let total = p["total_score"].as_i64().unwrap_or_default() + i64::from(points + bonus);
        p["module_results"] = json!({"liberated_mines":points,"greatest_liberator":bonus});
        p["total_score"] = json!(total);
        ranks.push((total, s.players[i].id.to_string()));
    }
    ranks.sort_by_key(|r| std::cmp::Reverse(r.0));
    value["rankings"] = json!(ranks.iter().map(|r| &r.1).collect::<Vec<_>>());
    value["is_tied"] = json!(ranks[0].0 == ranks[1].0);
    value
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mine_guards_production_and_liberation() {
        let mut s = setup(17, &[Hero::Arythea, Hero::Krang], "mines_liberation_2p").unwrap();
        deck(&mut s);
        let i = s
            .map
            .tile_deck
            .countryside
            .iter()
            .position(|&t| has_mine(t))
            .unwrap();
        s.map.tile_deck.countryside.swap(0, i);
        mk_engine::setup::place_initial_tiles(&mut s);
        reveal(&mut s);
        let key = s
            .map
            .hexes
            .values()
            .find(|h| {
                h.site
                    .as_ref()
                    .is_some_and(|t| t.site_type == SiteType::Mine)
            })
            .unwrap()
            .coord;
        let h = &s.map.hexes[&key.key()];
        assert_eq!(h.enemies.len(), 2);
        assert!(h.enemies[0].is_revealed);
        assert!(!h.enemies[1].is_revealed);
        assert!(h.site.as_ref().unwrap().mine_color.is_none());
        s.players[0].position = Some(key);
        assert!(!may_fight(&s, 0));
        s.round_phase = RoundPhase::PlayerTurns;
        fight(&mut s, 0, &mut UndoStack::new()).unwrap();
        let battle = s.combat.take().unwrap();
        assert!(battle.units_allowed && battle.night_mana_rules);
        assert_eq!(battle.enemies.len(), 2);
        let site = s
            .map
            .hexes
            .get_mut(&key.key())
            .unwrap()
            .site
            .as_mut()
            .unwrap();
        site.is_conquered = true;
        site.owner = Some(s.players[0].id.clone());
        after(&mut s, false);
        assert!(s.map.hexes[&key.key()]
            .site
            .as_ref()
            .unwrap()
            .mine_color
            .is_some());
        assert_eq!(s.players[0].reputation, 1);
        after(&mut s, false);
        assert_eq!(s.players[0].reputation, 1);
    }
}
