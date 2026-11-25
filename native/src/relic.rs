use mk_data::{
    cards,
    enemy_piles::{discard_enemy_token, draw_enemy_token},
    levels, tiles, units,
};
use mk_engine::{
    combat::{execute_enter_combat, EnterCombatOptions},
    setup::{create_mana_source, generate_tile_slots},
    undo::UndoStack,
};
use mk_types::{
    enums::*,
    hex::HexCoord,
    ids::{CardId, SkillId, UnitId},
    legal_action::LegalAction,
    state::{Crystals, GameState, HexEnemy, PlayerUnit},
};
use serde_json::{json, Value};
use std::cell::RefCell;

struct Draft {
    seat: usize,
    influence: u32,
    free_action: bool,
    skills: Vec<SkillId>,
    actions: Vec<CardId>,
    units: Vec<UnitId>,
    spells: Vec<CardId>,
    artifacts: Vec<CardId>,
}
thread_local! {static DRAFT:RefCell<Vec<Draft>>=const {RefCell::new(Vec::new())};}
pub fn active(s: &GameState) -> bool {
    s.scenario_id.as_str().starts_with("lost_relic_")
}
pub fn setup(seed: u32, heroes: &[Hero], id: &str) -> Result<GameState, String> {
    let n = heroes.len();
    let mut s = if n == 1 && id == "lost_relic_solo" {
        crate::conquest::solo(seed, heroes[0])
    } else if (2..=4).contains(&n) && id == format!("lost_relic_cooperative_{n}p") {
        let mut cfg = mk_data::scenarios::full_conquest_2p();
        cfg.pvp_enabled = false;
        cfg.dummy_tactic_order = DummyTacticOrder::BeforeHumans;
        cfg.scoring_config = mk_data::scenarios::first_reconnaissance().scoring_config;
        let mut s = mk_engine::setup::create_multiplayer_game(seed, heroes, cfg, id);
        crate::conquest::add_dummy(&mut s, heroes);
        s
    } else {
        return Err("Invalid Lost Relic seat count".into());
    };
    s.scenario_id = id.into();
    let c = &mut s.scenario_config;
    c.total_rounds = 2;
    c.day_rounds = 1;
    c.night_rounds = 1;
    c.map_shape = match n {
        1 => MapShape::Open3,
        2 => MapShape::Open4,
        _ => MapShape::Open,
    };
    c.countryside_tile_count = 5 + n as u32;
    c.core_tile_count = n as u32;
    c.city_tile_count = n as u32 + 1;
    c.fame_per_level_crossed = 1;
    c.extra_source_dice = 1;
    c.extra_unit_offer_slots = 1;
    c.end_trigger = ScenarioEndTrigger::RoundLimit;
    let mut deck_config = c.clone();
    deck_config.city_tile_count = deck_config.city_tile_count.min(4);
    s.map.tile_deck = tiles::create_tile_deck(&deck_config, &mut s.rng);
    if n == 4 {
        s.map.tile_deck.core.push(TileId::CoreVolkare);
        s.rng.shuffle(&mut s.map.tile_deck.core);
    }
    s.map.tile_slots = generate_tile_slots(
        c.map_shape,
        1 + c.countryside_tile_count + c.core_tile_count + c.city_tile_count,
    );
    s.source = create_mana_source(n as u32, 1, TimeOfDay::Day, &mut s.rng);
    s.decks.elite_unit_deck.retain(|id| {
        units::get_unit(id.as_str()).is_some_and(|u| u.recruit_sites != [RecruitSite::City])
    });
    Ok(s)
}
pub fn chooser(s: &GameState) -> Option<usize> {
    if active(s) {
        DRAFT.with_borrow(|d| d.last().map(|d| d.seat))
    } else {
        None
    }
}
fn amount(crystals: &mut Crystals, color: BasicManaColor) -> &mut u8 {
    match color {
        BasicManaColor::Red => &mut crystals.red,
        BasicManaColor::Green => &mut crystals.green,
        BasicManaColor::White => &mut crystals.white,
        BasicManaColor::Blue => &mut crystals.blue,
    }
}
fn pool<T>(deck: &mut Vec<T>, n: usize) -> Vec<T> {
    deck.drain(..n.min(deck.len())).collect()
}
pub fn draft(s: &mut GameState) {
    use BasicManaColor::*;
    s.decks
        .advanced_action_deck
        .append(&mut s.offers.advanced_actions);
    s.decks.unit_deck.append(&mut s.offers.units);
    s.decks.spell_deck.append(&mut s.offers.spells);
    s.rng.shuffle(&mut s.decks.advanced_action_deck);
    s.rng.shuffle(&mut s.decks.unit_deck);
    s.rng.shuffle(&mut s.decks.spell_deck);
    let mut drafts = vec![];
    for (seat, p) in s.players.iter_mut().enumerate() {
        let colors = match p.hero {
            Hero::Arythea => [Red, White],
            Hero::Tovak => [Blue, Red],
            Hero::Norowas => [White, Green],
            Hero::Goldyx | Hero::Braevalar => [Green, Blue],
            Hero::Krang => [Red, Green],
            Hero::Wolfhawk => [White, Blue],
        };
        p.crystals = Crystals::default();
        for c in colors {
            *amount(&mut p.crystals, c) += 1;
        }
        p.level = 3;
        p.fame = 9;
        let stats = levels::get_level_stats(3);
        p.command_tokens = stats.command_slots;
        p.armor = stats.armor;
        p.hand_limit = stats.hand_limit;
        p.deck.append(&mut p.hand);
        drafts.push(Draft {
            seat,
            influence: 18,
            free_action: true,
            skills: pool(&mut p.remaining_hero_skills, 2),
            actions: pool(&mut s.decks.advanced_action_deck, 5),
            units: pool(&mut s.decks.unit_deck, 4),
            spells: pool(&mut s.decks.spell_deck, 3),
            artifacts: pool(&mut s.decks.artifact_deck, 2),
        });
    }
    drafts.reverse();
    DRAFT.with_borrow_mut(|d| *d = drafts);
}
pub fn offers(s: &GameState) -> Vec<Value> {
    if !active(s) {
        return vec![];
    }
    DRAFT.with_borrow(|d|{
        let Some(d)=d.last() else{return vec![]};
        if !d.skills.is_empty(){return d.skills.iter().map(|id|json!({"LearnStartingSkill":{"skill":id}})).collect()}
        let mut out=vec![];
        let mut add=|kind:&str,id:&str,price:u32,color:Option<BasicManaColor>|{
            if price<=d.influence{out.push(json!({"PrepareExpedition":{"kind":kind,"item":id,"influence":price,"crystal":color}}))}
        };
        for id in &d.actions{add("advanced action",id.as_str(),if d.free_action{0}else{6},None);}
        for id in &d.artifacts{add("artifact",id.as_str(),12,None)}
        for id in &d.spells{
            add("spell",id.as_str(),9,None);
            if let Some(c)=cards::get_spell_color(id.as_str()){
                if *amount(&mut s.players[d.seat].crystals.clone(),c)>0{add("spell",id.as_str(),7,Some(c))}
            }
        }
        if s.players[d.seat].units.len()<s.players[d.seat].command_tokens as usize{
            for id in &d.units{if let Some(u)=units::get_unit(id.as_str()){
                if id.as_str()=="magic_familiars"{for c in ALL_BASIC_MANA_COLORS{if *amount(&mut s.players[d.seat].crystals.clone(),c)>0{add("unit",id.as_str(),u.influence_cost,Some(c))}}}
                else{add("unit",id.as_str(),u.influence_cost,None)}
            }}
        }
        for c in ALL_BASIC_MANA_COLORS{if *amount(&mut s.players[d.seat].crystals.clone(),c)<3{add("crystal","supply",3,Some(c))}}
        if !d.free_action{out.push(json!("FinishPreparation"));}
        out
    })
}
pub fn purchase(s: &mut GameState, a: &Value, undo: &mut UndoStack) -> Result<(), String> {
    if !offers(s).contains(a) {
        return Err("That starting purchase is unavailable".into());
    }
    DRAFT.with_borrow_mut(|slot| {
        let d = slot.last_mut().unwrap();
        let p = &mut s.players[d.seat];
        if let Some(t) = a.get("LearnStartingSkill") {
            let k = t["skill"].as_str().unwrap();
            let i = d.skills.iter().position(|v| v.as_str() == k).unwrap();
            p.skills.push(d.skills.remove(i));
            s.offers.common_skills.append(&mut d.skills);
        } else if a.as_str() == Some("FinishPreparation") {
            if d.influence > 0 {
                p.fame += 1;
            }
            s.decks.advanced_action_deck.append(&mut d.actions);
            s.decks.spell_deck.append(&mut d.spells);
            s.decks.artifact_deck.append(&mut d.artifacts);
            s.decks.unit_deck.append(&mut d.units);
            slot.pop();
            if !slot.is_empty() {
                return;
            }
            s.rng.shuffle(&mut s.decks.advanced_action_deck);
            s.rng.shuffle(&mut s.decks.spell_deck);
            s.rng.shuffle(&mut s.decks.artifact_deck);
            s.rng.shuffle(&mut s.decks.unit_deck);
            for p in &mut s.players {
                s.rng.shuffle(&mut p.deck);
                p.hand = pool(&mut p.deck, p.hand_limit as usize);
            }
            s.offers.spells = pool(&mut s.decks.spell_deck, 3);
            s.offers.advanced_actions = pool(&mut s.decks.advanced_action_deck, 3);
            s.offers.units = pool(&mut s.decks.unit_deck, 3 + s.players.len());
            let shape = s.scenario_config.map_shape;
            s.scenario_config.map_shape = MapShape::Open3;
            mk_engine::setup::place_initial_tiles(s);
            s.scenario_config.map_shape = shape;
        } else {
            let purchase = &a["PrepareExpedition"];
            let item = purchase["item"].as_str().unwrap();
            let kind = purchase["kind"].as_str().unwrap();
            d.influence -= purchase["influence"].as_u64().unwrap() as u32;
            let color: Option<BasicManaColor> =
                serde_json::from_value(purchase["crystal"].clone()).unwrap();
            if let Some(c) = color {
                let n = amount(&mut p.crystals, c);
                if kind == "crystal" {
                    *n += 1
                } else {
                    *n -= 1
                }
            }
            if kind == "unit" {
                let ix = d.units.iter().position(|id| id.as_str() == item).unwrap();
                let unit_id = d.units.remove(ix);
                p.units.push(PlayerUnit {
                    instance_id: format!("unit_{}", s.next_instance_counter).into(),
                    unit_id,
                    level: units::get_unit(item).unwrap().level,
                    state: UnitState::Ready,
                    wounded: false,
                    used_resistance_this_combat: false,
                    used_ability_indices: vec![],
                    mana_token: color.map(|c| mk_types::state::ManaToken {
                        color: c.into(),
                        source: mk_types::state::ManaTokenSource::Effect,
                        cannot_power_spells: false,
                    }),
                });
                s.next_instance_counter += 1;
            } else if kind != "crystal" {
                let supply = match kind {
                    "advanced action" => {
                        d.free_action = false;
                        &mut d.actions
                    }
                    "spell" => &mut d.spells,
                    _ => &mut d.artifacts,
                };
                let ix = supply.iter().position(|id| id.as_str() == item).unwrap();
                p.deck.push(supply.remove(ix));
            }
        }
    });
    undo.set_checkpoint();
    s.action_epoch += 1;
    Ok(())
}
fn ruins(s: &GameState, c: HexCoord) -> bool {
    let Some(h) = s.map.hexes.get(&c.key()) else {
        return false;
    };
    if !tiles::is_city_tile(h.tile_id) && h.tile_id != TileId::CoreVolkare {
        return false;
    }
    let Some(tile) = s.map.tiles.iter().find(|t| t.tile_id == h.tile_id) else {
        return false;
    };
    tiles::get_tile_hexes(h.tile_id).is_some_and(|defs| {
        defs.iter().any(|d| {
            matches!(d.site_type, Some(SiteType::City | SiteType::VolkaresCamp))
                && d.local.q + tile.center_coord.q == c.q
                && d.local.r + tile.center_coord.r == c.r
        })
    })
}
pub fn reveal(s: &mut GameState, first: usize, i: usize) {
    for t in &s.map.tiles[first..] {
        s.players[i].fame +=
            1 + u32::from(tiles::is_city_tile(t.tile_id) || t.tile_id == TileId::CoreVolkare);
        if !tiles::is_core_tile(t.tile_id) {
            continue;
        }
        for h in s.map.hexes.values_mut().filter(|h| h.tile_id == t.tile_id) {
            let destroyed = h
                .site
                .as_ref()
                .is_some_and(|v| matches!(v.site_type, SiteType::City | SiteType::VolkaresCamp));
            let rampager = h.rampaging_enemies.contains(&RampagingEnemyType::Draconum);
            if !destroyed && !rampager {
                continue;
            }
            let color = if destroyed {
                h.site = None;
                h.terrain = Terrain::Plains;
                EnemyColor::Red
            } else {
                for r in &mut h.rampaging_enemies {
                    if *r == RampagingEnemyType::Draconum {
                        *r = RampagingEnemyType::OrcMarauder;
                    }
                }
                EnemyColor::Green
            };
            for enemy in h.enemies.drain(..) {
                discard_enemy_token(&mut s.enemy_tokens, &enemy.token_id, enemy.color);
            }
            if let Some(token_id) = draw_enemy_token(&mut s.enemy_tokens, color, &mut s.rng) {
                h.enemies.push(HexEnemy {
                    token_id,
                    color,
                    is_revealed: !destroyed,
                });
            }
        }
    }
    s.cities.clear();
}
pub fn uncover_adjacent(s: &mut GameState) {
    let positions: Vec<_> = s.players.iter().filter_map(|p| p.position).collect();
    let sites: Vec<_> = s
        .map
        .hexes
        .values()
        .filter(|h| positions.iter().any(|p| p.distance(h.coord) <= 1) && ruins(s, h.coord))
        .map(|h| h.coord)
        .collect();
    for c in sites {
        for e in &mut s.map.hexes.get_mut(&c.key()).unwrap().enemies {
            e.is_revealed = true;
        }
    }
}
pub fn enter(
    s: &mut GameState,
    i: usize,
    c: HexCoord,
    from: Option<HexCoord>,
) -> Result<(), String> {
    if !ruins(s, c) {
        return Ok(());
    }
    let Some(enemy) = s.map.hexes[&c.key()].enemies.first() else {
        return Ok(());
    };
    let token = enemy.token_id.clone();
    let previous = s.combat.take();
    execute_enter_combat(
        s,
        i,
        &[token],
        false,
        Some(c),
        EnterCombatOptions::default(),
    )
    .map_err(|e| format!("{e:?}"))?;
    let fight = s.combat.as_mut().unwrap();
    fight.enemies[0].is_required_for_conquest = true;
    fight.enemies[0].instance_id = "relic_guard".into();
    fight.assault_origin = from;
    if let Some(other) = previous {
        fight.enemies.extend(other.enemies);
    }
    s.players[i].flags.insert(
        mk_types::state::PlayerFlags::HAS_TAKEN_ACTION_THIS_TURN
            | mk_types::state::PlayerFlags::HAS_COMBATTED_THIS_TURN,
    );
    Ok(())
}
pub fn ending(s: &GameState, action: &LegalAction) -> Option<(HexCoord, Option<HexCoord>, bool)> {
    if !matches!(action, LegalAction::EndCombatPhase) {
        return None;
    }
    let combat = s.combat.as_ref()?;
    let c = combat.combat_hex_coord?;
    let guard = combat
        .enemies
        .iter()
        .find(|e| e.instance_id.as_str() == "relic_guard")?;
    Some((c, combat.assault_origin, guard.is_defeated))
}
fn collected(s: &GameState) -> usize {
    s.map
        .hexes
        .values()
        .filter(|h| ruins(s, h.coord) && !h.shield_tokens.is_empty())
        .count()
}
pub fn finish(
    s: &mut GameState,
    i: usize,
    (c, origin, defeated): (HexCoord, Option<HexCoord>, bool),
) {
    if s.combat.is_some() {
        return;
    }
    if defeated {
        let shields = &mut s.map.hexes.get_mut(&c.key()).unwrap().shield_tokens;
        if shields.is_empty() {
            shields.push(s.players[i].id.clone());
        }
        if collected(s) == s.scenario_config.city_tile_count as usize {
            s.scenario_end_triggered = true;
            // The current turn still has to close before the hero gets one final turn.
            s.final_turns_remaining = Some(s.players.len() as u32 + 1);
            s.turn_order
                .retain(|id| !mk_engine::dummy_player::is_dummy_player(id.as_str()));
            s.current_player_index = s
                .turn_order
                .iter()
                .position(|id| id == &s.players[i].id)
                .unwrap_or(0) as u32;
        }
    } else {
        s.players[i].position = origin;
    }
}
pub fn score(s: &GameState) -> Value {
    let Some(raw) = s.final_score_result.as_ref() else {
        return Value::Null;
    };
    let mut result = json!(raw);
    let n = collected(s);
    let won = n == s.scenario_config.city_tile_count as usize;
    let dummy = s.dummy_player.as_ref().map_or(0, |d| d.deck.len()) as i32;
    let bonus = i32::from(s.end_of_round_announced_by.is_none()) * 5;
    if s.players.len() > 1 {
        let categories = crate::conquest::team_categories(raw);
        let all = s.players.iter().all(|p| {
            s.map
                .hexes
                .values()
                .any(|h| ruins(s, h.coord) && h.shield_tokens.contains(&p.id))
        });
        let total = s.players.iter().map(|p| p.fame as i32).min().unwrap()
            + categories.values().sum::<i32>()
            + 5 * n as i32
            + 5 * i32::from(all)
            + 10 * i32::from(won)
            + dummy
            + bonus;
        result["rankings"] = json!([]);
        result["is_tied"] = json!(false);
        result["player_results"] = json!([{"outcome":if won{"victory"}else{"defeat"},"team_score":total,"relic_pieces":n,"each_hero_found_a_piece":all,"achievement_points":categories,"dummy_cards":dummy}]);
        return result;
    }
    let r = &mut result["player_results"][0];
    r["module_results"] = json!({"relic_pieces":n,"completion":i32::from(won)*10,"dummy_cards":dummy,"unannounced_round":bonus});
    r["outcome"] = json!(if won { "victory" } else { "defeat" });
    r["total_score"] = json!(
        raw.player_results[0].total_score + 5 * n as i32 + i32::from(won) * 10 + dummy + bonus
    );
    result
}
pub fn view(s: &GameState) -> Value {
    if !active(s) {
        return Value::Null;
    }
    let spaces: Vec<_> = s
        .map
        .hexes
        .values()
        .filter(|h| ruins(s, h.coord))
        .map(|h| h.coord.key())
        .collect();
    json!({"ruins":spaces,"collected":collected(s),"goal":s.scenario_config.city_tile_count,"influence":DRAFT.with_borrow(|d|d.last().map(|d|d.influence))})
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recover_both_relics_from_dragons_and_score() {
        let mut s = setup(88, &[Hero::Arythea], "lost_relic_solo").unwrap();
        s.map.tile_deck.countryside = vec![TileId::Core5GreenCity, TileId::Core6BlueCity];
        mk_engine::setup::place_initial_tiles(&mut s);
        reveal(&mut s, 1, 0);
        let cities: Vec<_> = s
            .map
            .hexes
            .values()
            .filter(|h| ruins(&s, h.coord))
            .map(|h| h.coord)
            .collect();
        assert_eq!(cities.len(), 2);
        for c in cities {
            let start = c.neighbors()[0];
            let h = &s.map.hexes[&c.key()];
            assert!(h.site.is_none());
            assert_eq!(h.enemies.len(), 1);
            assert_eq!(h.enemies[0].color, EnemyColor::Red);
            s.players[0].position = Some(start);
            uncover_adjacent(&mut s);
            assert!(s.map.hexes[&c.key()].enemies[0].is_revealed);
            s.players[0].position = Some(c);
            enter(&mut s, 0, c, Some(start)).unwrap();
            let battle = s.combat.as_mut().unwrap();
            assert!(!battle.is_at_fortified_site);
            battle.enemies[0].is_defeated = true;
            let resolved = ending(&s, &LegalAction::EndCombatPhase).unwrap();
            s.combat = None;
            finish(&mut s, 0, resolved);
        }
        assert!(s.scenario_end_triggered);
        assert_eq!(s.final_turns_remaining, Some(2));
        let remaining = s.dummy_player.as_ref().unwrap().deck.len();
        mk_engine::end_turn::advance_turn_pub(&mut s, 0);
        assert!(!s.game_ended);
        assert_eq!(s.final_turns_remaining, Some(1));
        assert_eq!(s.dummy_player.as_ref().unwrap().deck.len(), remaining);
        mk_engine::end_turn::advance_turn_pub(&mut s, 0);
        assert!(s.game_ended);
        let score = score(&s);
        let p = &score["player_results"][0];
        assert_eq!(p["outcome"], "victory");
        assert_eq!(p["module_results"]["relic_pieces"], 2);
    }
}
