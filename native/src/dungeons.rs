use mk_data::{enemy_piles::draw_enemy_token, tiles};
use mk_engine::undo::UndoStack;
use mk_types::{
    enums::{EnemyColor, RoundPhase, SiteType, Terrain, TileId},
    hex::HexCoord,
    state::{GameState, HexEnemy, PlayerFlags, Site},
};
use serde_json::{json, Value};
use std::{
    cell::RefCell,
    collections::{BTreeMap, VecDeque},
};
thread_local! {static CHOICES:RefCell<VecDeque<(HexCoord,SiteType)>>=RefCell::new(VecDeque::new());}
pub fn active(s: &GameState) -> bool {
    s.scenario_id.as_str().starts_with("dungeon_lords_")
}
fn adventure(t: SiteType) -> bool {
    matches!(t, SiteType::Dungeon | SiteType::Tomb)
}
pub fn deck(s: &mut GameState) {
    s.scenario_config.total_rounds = 5;
    s.scenario_config.day_rounds = 3;
    let has = |t, kind| {
        tiles::get_tile_hexes(t)
            .unwrap()
            .iter()
            .any(|h| h.site_type == Some(kind))
    };
    let (mut must, mut other): (Vec<_>, Vec<_>) = tiles::all_countryside_tiles()
        .into_iter()
        .partition(|&t| has(t, SiteType::Dungeon));
    s.rng.shuffle(&mut other);
    must.extend(
        other
            .into_iter()
            .take(s.scenario_config.countryside_tile_count as usize - must.len()),
    );
    s.rng.shuffle(&mut must);
    s.map.tile_deck.countryside = must;
    let (mut tomb, mut other): (Vec<_>, Vec<_>) = tiles::all_non_city_core_tiles()
        .into_iter()
        .partition(|&t| has(t, SiteType::Tomb) && has(t, SiteType::Monastery));
    s.rng.shuffle(&mut other);
    tomb.extend(
        other
            .into_iter()
            .take(s.scenario_config.core_tile_count as usize - tomb.len()),
    );
    tomb.push(TileId::Core6BlueCity);
    s.rng.shuffle(&mut tomb);
    s.map.tile_deck.core = tomb;
    CHOICES.with_borrow_mut(|q| q.clear());
}

fn destinations(s: &GameState, c: HexCoord) -> Vec<HexCoord> {
    c.neighbors()
        .into_iter()
        .filter(|h| {
            s.map.hexes.get(&h.key()).is_some_and(|hex| {
                hex.site.is_none()
                    && !matches!(
                        hex.terrain,
                        Terrain::Swamp | Terrain::Lake | Terrain::Mountain
                    )
                    && hex.rampaging_enemies.is_empty()
            })
        })
        .collect()
}
pub fn reveal(s: &mut GameState, first: usize) {
    crate::druid::friendly_city(s);
    CHOICES.with_borrow_mut(|q| {
        for t in &s.map.tiles[first..] {
            for h in s.map.hexes.values().filter(|h| h.tile_id == t.tile_id) {
                let st = match h.site.as_ref().map(|site| site.site_type) {
                    Some(SiteType::Village) => SiteType::Dungeon,
                    Some(SiteType::Monastery) => SiteType::Tomb,
                    _ => continue,
                };
                q.push_back((h.coord, st));
            }
        }
    });
}
pub fn placement(s: &GameState) -> Vec<Value> {
    if !active(s) {
        return vec![];
    }
    CHOICES.with_borrow_mut(|q| {
        while let Some(&(c, t)) = q.front() {
            let targets = destinations(s, c);
            if targets.is_empty() {
                q.pop_front();
                continue;
            }
            return targets
                .into_iter()
                .map(|target| json!({"PlaceEntrance":{"source":c,"site":t,"target":target}}))
                .collect();
        }
        vec![]
    })
}
fn is_conquered(s: &GameState, pos: HexCoord) -> bool {
    s.map
        .hexes
        .get(&pos.key())
        .and_then(|h| h.site.as_ref())
        .is_some_and(|t| adventure(t.site_type) && t.is_conquered)
}
pub fn tunnels(s: &GameState, i: usize) -> Vec<Value> {
    if !active(s) || s.round_phase != RoundPhase::PlayerTurns || s.game_ended || s.combat.is_some()
    {
        return vec![];
    }
    let p = &s.players[i];
    let Some(pos) = p.position else { return vec![] };
    if !p.pending.is_empty()
        || !is_conquered(s, pos)
        || p.flags.intersects(
            PlayerFlags::HAS_TAKEN_ACTION_THIS_TURN
                | PlayerFlags::IS_RESTING
                | PlayerFlags::HAS_RESTED_THIS_TURN,
        )
        || p.move_points < 3
    {
        return vec![];
    }
    let mut seen = BTreeMap::new();
    seen.insert(pos.key(), 0);
    let mut queue = VecDeque::from([(pos, 0u32)]);
    let mut actions = Vec::new();
    while let Some((from, n)) = queue.pop_front() {
        for target in from.neighbors() {
            if seen.contains_key(&target.key()) || n + 3 > p.move_points {
                continue;
            }
            let Some(h) = s.map.hexes.get(&target.key()) else {
                continue;
            };
            if matches!(h.terrain, Terrain::Lake | Terrain::Swamp) {
                continue;
            }
            seen.insert(target.key(), n + 1);
            queue.push_back((target, n + 1));
            if is_conquered(s, target) && !s.players.iter().any(|p| p.position == Some(target)) {
                actions.push(json!({"TravelTunnel":{"target":target,"cost":n+3}}))
            }
        }
    }
    actions
}
pub fn apply(s: &mut GameState, i: usize, a: &Value, undo: &mut UndoStack) -> Result<(), String> {
    if a.get("PlaceEntrance").is_some() {
        if !placement(s).contains(a) {
            return Err("Choose a legal entrance space".into());
        }
        let c: HexCoord = serde_json::from_value(a["PlaceEntrance"]["target"].clone())
            .map_err(|e| e.to_string())?;
        let (_, st) = CHOICES.with_borrow_mut(|q| q.pop_front().unwrap());
        let color = if st == SiteType::Dungeon {
            EnemyColor::Brown
        } else {
            EnemyColor::Red
        };
        let h = s.map.hexes.get_mut(&c.key()).unwrap();
        h.site = Some(Site {
            site_type: st,
            owner: None,
            is_conquered: false,
            is_burned: false,
            city_color: None,
            mine_color: None,
            deep_mine_colors: None,
        });
        if let Some(token_id) = draw_enemy_token(&mut s.enemy_tokens, color, &mut s.rng) {
            h.enemies.push(HexEnemy {
                token_id,
                color,
                is_revealed: false,
            });
        }
        undo.set_checkpoint();
    } else {
        if !placement(s).is_empty() || !tunnels(s, i).contains(a) {
            return Err("Tunnel destination is unavailable".into());
        }
        let raw = &a["TravelTunnel"];
        let c: HexCoord =
            serde_json::from_value(raw["target"].clone()).map_err(|e| e.to_string())?;
        undo.save(s);
        s.players[i].move_points -= raw["cost"].as_u64().unwrap() as u32;
        s.players[i].position = Some(c);
        s.players[i].flags.insert(PlayerFlags::HAS_MOVED_THIS_TURN);
    }
    s.action_epoch += 1;
    Ok(())
}
pub fn before_entry(s: &mut GameState, i: usize) -> Result<(), String> {
    let c = s.players[i].position.ok_or("Hero has no position")?;
    if is_conquered(s, c) {
        return Err("This entrance has already been conquered".into());
    }
    let h = s.map.hexes.get_mut(&c.key()).unwrap();
    if h.site.as_ref().is_some_and(|t| adventure(t.site_type)) {
        if let Some(e) = h.enemies.pop() {
            let pile = if e.color == EnemyColor::Brown {
                &mut s.enemy_tokens.brown_draw
            } else {
                &mut s.enemy_tokens.red_draw
            };
            pile.insert(0, e.token_id);
        }
    }
    Ok(())
}
pub fn permitted(s: &GameState, i: usize, a: &Value) -> bool {
    a.as_str() != Some("EnterSite") || !s.players[i].position.is_some_and(|c| is_conquered(s, c))
}
pub fn after(s: &mut GameState) {
    if s.scenario_end_triggered
        || !s.map.tile_deck.core.is_empty()
        || !s.map.tile_deck.countryside.is_empty()
        || !placement(s).is_empty()
    {
        return;
    }
    if s.map
        .hexes
        .values()
        .filter_map(|h| h.site.as_ref())
        .filter(|site| adventure(site.site_type))
        .all(|site| site.is_conquered)
    {
        s.scenario_end_triggered = true;
        s.final_turns_remaining = Some(s.players.len() as u32 + 1);
    }
}
pub fn score(s: &GameState, mut score: Value) -> Value {
    let mut modified = vec![];
    for (i, p) in s.players.iter().enumerate() {
        let sites = s
            .map
            .hexes
            .values()
            .filter(|h| {
                h.site.as_ref().is_some_and(|t| adventure(t.site_type))
                    && h.shield_tokens.contains(&p.id)
            })
            .count() as i64;
        let r = &score["player_results"][i];
        let cat = r["achievements"]["category_scores"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["category"] == "greatest_adventurer")
            .unwrap();
        let old = cat["total_points"].as_i64().unwrap_or(0);
        let points = cat["base_points"].as_i64().unwrap_or(0) + 2 * sites;
        modified.push((old, points))
    }
    let best = modified.iter().map(|x| x.1).max().unwrap_or(0);
    let tied = modified.iter().filter(|x| x.1 == best).count() > 1;
    let mut ranks = vec![];
    for (i, (old, new)) in modified.into_iter().enumerate() {
        let r = &mut score["player_results"][i];
        let bonus = if new == best && best > 0 {
            if tied {
                2
            } else {
                5
            }
        } else {
            0
        };
        let delta = new + bonus - old;
        let cat = r["achievements"]["category_scores"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|a| a["category"] == "greatest_adventurer")
            .unwrap();
        cat["category"] = json!("greatest_dungeon_crawler");
        cat["base_points"] = json!(new);
        cat["title_bonus"] = json!(bonus);
        cat["has_title"] = json!(bonus > 0);
        cat["is_tied"] = json!(bonus > 0 && tied);
        cat["total_points"] = json!(new + bonus);
        let achievements = r["achievements"]["total_achievement_points"]
            .as_i64()
            .unwrap()
            + delta;
        r["achievements"]["total_achievement_points"] = json!(achievements);
        let total = r["total_score"].as_i64().unwrap() + delta;
        r["total_score"] = json!(total);
        ranks.push((total, s.players[i].id.to_string()));
    }
    ranks.sort_by_key(|r| std::cmp::Reverse(r.0));
    score["rankings"] = json!(ranks.iter().map(|r| &r.1).collect::<Vec<_>>());
    score["is_tied"] = json!(ranks[0].0 == ranks[1].0);
    score
}
