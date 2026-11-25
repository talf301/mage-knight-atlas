use mk_data::{
    enemy_piles::{discard_enemy_token, draw_enemy_token},
    sites::is_inhabited,
    tiles,
};
use mk_engine::{
    combat::{execute_enter_combat, EnterCombatOptions},
    undo::UndoStack,
};
use mk_types::{
    enums::{EnemyColor, RoundPhase, SiteType, TileId},
    ids::EnemyTokenId,
    pending::{DeferredPending, SiteReward},
    state::{GameState, PlayerFlags},
};
use std::cell::RefCell;

#[derive(Default)]
struct Ritual {
    casters: Vec<(u32, usize)>,
    monsters: Vec<EnemyTokenId>,
    color: Option<EnemyColor>,
    paid: u32,
    marked_turn: Option<(u32, u32, usize)>,
}
thread_local! {static RITUAL:RefCell<Ritual>=RefCell::new(Ritual::default());}
pub fn active(s: &GameState) -> bool {
    s.scenario_id.as_str().starts_with("druid_nights_")
}
pub fn reset() {
    RITUAL.with_borrow_mut(|r| *r = Ritual::default())
}
pub fn deck(s: &mut GameState) {
    let (mut glades, mut rest): (Vec<_>, Vec<_>) =
        tiles::all_countryside_tiles().into_iter().partition(|&t| {
            tiles::get_tile_hexes(t)
                .unwrap()
                .iter()
                .any(|h| h.site_type == Some(SiteType::MagicalGlade))
        });
    s.rng.shuffle(&mut rest);
    glades.extend(
        rest.into_iter()
            .take(s.scenario_config.countryside_tile_count as usize - glades.len()),
    );
    s.rng.shuffle(&mut glades);
    s.map.tile_deck.countryside = glades;
    s.map.tile_deck.core.retain(|t| !tiles::is_city_tile(*t));
    s.map.tile_deck.core.push(TileId::Core5GreenCity);
    s.rng.shuffle(&mut s.map.tile_deck.core);
}
pub fn friendly_city(s: &mut GameState) {
    for h in s.map.hexes.values_mut() {
        if let Some(site) = h.site.as_mut() {
            if site.site_type == SiteType::City && !site.is_conquered {
                site.is_conquered = true;
                h.enemies.clear();
                h.shield_tokens
                    .extend(s.players.iter().map(|p| p.id.clone()));
            }
        }
    }
}
fn marked(s: &GameState, i: usize) -> usize {
    s.map
        .hexes
        .values()
        .filter(|h| {
            h.site
                .as_ref()
                .is_some_and(|site| site.site_type == SiteType::MagicalGlade)
                && h.shield_tokens.contains(&s.players[i].id)
        })
        .count()
}
pub fn available(s: &GameState, i: usize) -> Vec<&'static str> {
    let p = &s.players[i];
    if !active(s)
        || s.game_ended
        || s.round_phase != RoundPhase::PlayerTurns
        || s.combat.is_some()
        || !p.pending.is_empty()
        || p.flags.intersects(
            PlayerFlags::IS_RESTING
                | PlayerFlags::HAS_RESTED_THIS_TURN
                | PlayerFlags::HAS_TAKEN_ACTION_THIS_TURN
                | PlayerFlags::IS_INTERACTING
                | PlayerFlags::KNOCKED_OUT,
        )
    {
        return vec![];
    }
    let Some(h) = p.position.and_then(|pos| s.map.hexes.get(&pos.key())) else {
        return vec![];
    };
    let site = h.site.as_ref().map(|s| s.site_type);
    let mut actions = vec![];
    if site == Some(SiteType::MagicalGlade) && !h.shield_tokens.contains(&p.id) {
        actions.push("MarkGlade")
    }
    if s.round % 2 == 0
        && !site.is_some_and(is_inhabited)
        && marked(s, i) > 0
        && !RITUAL.with_borrow(|r| r.casters.contains(&(s.round, i)))
    {
        actions.push("PerformIncantation")
    }
    actions
}
pub fn permitted(s: &GameState, i: usize, a: &serde_json::Value) -> bool {
    if !active(s) {
        return true;
    }
    RITUAL.with_borrow(|r| {
        let marked = r.marked_turn == Some((s.round, s.turn_number, i));
        !(marked && (a.get("Move").is_some() || a.get("Explore").is_some()))
    })
}
pub fn apply(s: &mut GameState, i: usize, a: &str, undo: &mut UndoStack) -> Result<(), String> {
    if !available(s, i).contains(&a) {
        return Err("Ritual action unavailable".into());
    }
    if a == "MarkGlade" {
        undo.set_checkpoint();
        RITUAL.with_borrow_mut(|r| r.marked_turn = Some((s.round, s.turn_number, i)));
        let p = &s.players[i];
        s.map
            .hexes
            .get_mut(&p.position.unwrap().key())
            .unwrap()
            .shield_tokens
            .push(p.id.clone());
        // Marking a glade ends movement. Other non-movement actions are still legal.
        s.players[i].move_points = 0;
    } else {
        let n = marked(s, i);
        let color = if s.round == 2 {
            EnemyColor::Brown
        } else {
            EnemyColor::Red
        };
        let mut candidate = s.clone();
        let ids = (0..n)
            .map(|_| {
                draw_enemy_token(&mut candidate.enemy_tokens, color, &mut candidate.rng)
                    .ok_or("Monster supply exhausted")
            })
            .collect::<Result<Vec<_>, _>>()?;
        execute_enter_combat(
            &mut candidate,
            i,
            &ids,
            false,
            None,
            EnterCombatOptions::default(),
        )
        .map_err(|e| format!("{e:?}"))?;
        *s = candidate;
        RITUAL.with_borrow_mut(|r| {
            r.casters.push((s.round, i));
            r.monsters = ids;
            r.paid = 0;
            r.color = Some(color);
        });
        undo.set_checkpoint();
        s.players[i]
            .flags
            .insert(PlayerFlags::HAS_TAKEN_ACTION_THIS_TURN | PlayerFlags::HAS_COMBATTED_THIS_TURN);
        if s.round == 4
            && RITUAL.with_borrow(|r| {
                r.casters.iter().filter(|(round, _)| *round == 4).count() == s.players.len()
            })
        {
            s.scenario_end_triggered = true;
            s.final_turns_remaining = Some(s.players.len() as u32 + 1);
        }
    }
    s.action_epoch += 1;
    Ok(())
}
pub fn after(
    s: &mut GameState,
    i: usize,
    old_round: u32,
    undo: &mut UndoStack,
    previous_fame: u32,
) {
    if old_round == 2 && s.round == 3 {
        for h in s.map.hexes.values_mut() {
            if h.site
                .as_ref()
                .is_some_and(|t| t.site_type == SiteType::MagicalGlade)
            {
                h.shield_tokens.clear()
            }
        }
    }
    RITUAL.with_borrow_mut(|r| {
        let Some(color) = r.color else { return };
        let fame = s.combat.as_ref().map_or(previous_fame, |c| c.fame_gained);
        if fame > r.paid {
            s.players[i].fame += fame - r.paid;
            r.paid = fame;
            undo.set_checkpoint();
        }
        if s.combat.is_none() {
            let count = r.monsters.len() as u32 * if s.round == 4 { 2 } else { 1 };
            for id in r.monsters.drain(..) {
                discard_enemy_token(&mut s.enemy_tokens, &id, color)
            }
            let reward = DeferredPending::Rewards(
                std::iter::once(SiteReward::CrystalRoll { count }).collect(),
            );
            s.players[i].pending.deferred.push(reward);
            r.color = None;
            undo.set_checkpoint();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use mk_types::enums::Hero;
    #[test]
    fn incantation_respects_round_location_and_used_marks() {
        let mut s =
            crate::mines::setup(42, &[Hero::Arythea, Hero::Tovak], "mines_liberation_2p").unwrap();
        s.scenario_id = "druid_nights_2p".into();
        deck(&mut s);
        let index = s
            .map
            .tile_deck
            .countryside
            .iter()
            .position(|&t| {
                tiles::get_tile_hexes(t)
                    .unwrap()
                    .iter()
                    .any(|h| h.site_type == Some(SiteType::MagicalGlade))
            })
            .unwrap();
        s.map.tile_deck.countryside.swap(0, index);
        mk_engine::setup::place_initial_tiles(&mut s);
        reset();
        s.players[0].position = s
            .map
            .hexes
            .values()
            .find(|h| {
                h.site
                    .as_ref()
                    .is_some_and(|q| q.site_type == SiteType::MagicalGlade)
            })
            .map(|h| h.coord);
        s.round_phase = RoundPhase::PlayerTurns;
        let mut u = UndoStack::new();
        apply(&mut s, 0, "MarkGlade", &mut u).unwrap();
        assert!(!available(&s, 0).contains(&"MarkGlade"));
        assert!(!permitted(&s, 0, &serde_json::json!({"Move":{}})));
        s.turn_number += 1;
        assert!(permitted(&s, 0, &serde_json::json!({"Move":{}})));
        assert!(!available(&s, 0).contains(&"PerformIncantation"));
        s.round = 2;
        apply(&mut s, 0, "PerformIncantation", &mut u).unwrap();
        assert_eq!(s.combat.as_ref().unwrap().enemies.len(), 1);
        s.combat = None;
        after(&mut s, 0, 2, &mut u, 3);
        assert_eq!(s.players[0].fame, 3);
        assert!(s.players[0].pending.has_deferred());
        assert!(!available(&s, 0).contains(&"PerformIncantation"));
        s.round = 3;
        after(&mut s, 0, 2, &mut u, 0);
        assert_eq!(marked(&s, 0), 0);
    }
}
