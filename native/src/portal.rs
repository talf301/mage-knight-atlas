use mk_data::{scenarios, tiles};
use mk_engine::{
    scoring::calculate_final_scores,
    setup::{create_multiplayer_game, generate_tile_slots},
};
use mk_types::{
    enums::{GamePhase, Hero, MapShape, ScenarioEndTrigger, Terrain},
    hex::HexCoord,
    state::GameState,
};
use serde_json::{json, Value};

pub fn active(s: &GameState) -> bool {
    s.scenario_id.as_str().starts_with("one_to_return_")
}
pub fn setup(seed: u32, heroes: &[Hero], id: &str) -> Result<GameState, String> {
    let n = heroes.len();
    if !(2..=4).contains(&n) || id != format!("one_to_return_{n}p") {
        return Err("One to Return requires two to four heroes".into());
    }
    let mut config = scenarios::full_conquest_2p();
    config.countryside_tile_count = [7, 8, 10][n - 2];
    config.city_tile_count = n as u32 - 1;
    config.core_tile_count = n as u32 - 1;
    config.map_shape = MapShape::Wedge;
    config.default_city_level = 3;
    config.total_rounds = 4;
    config.day_rounds = 2;
    config.night_rounds = 2;
    config.end_trigger = ScenarioEndTrigger::RoundLimit;
    let mut s = create_multiplayer_game(seed, heroes, config, id);
    s.city_level = 3;
    s.map.tile_slots = generate_tile_slots(
        MapShape::Wedge,
        s.scenario_config.countryside_tile_count + 2 * (n as u32 - 1) + 1,
    );
    s.map.tile_deck = tiles::create_tile_deck(&s.scenario_config, &mut s.rng);
    Ok(s)
}
fn portal() -> HexCoord {
    HexCoord::new(0, 0)
}
pub fn close(s: &mut GameState) {
    let hex = s.map.hexes.get_mut(&portal().key()).unwrap();
    hex.terrain = Terrain::Plains;
    hex.site = None;
    let eliminated = s
        .players
        .iter()
        .filter(|p| p.position.is_none() || p.position == Some(portal()))
        .map(|p| p.id.clone())
        .collect::<Vec<_>>();
    if eliminated.len() == s.players.len() {
        s.game_ended = true;
        s.phase = GamePhase::End;
        s.final_score_result = Some(calculate_final_scores(s));
        return;
    }
    s.players.retain(|p| !eliminated.contains(&p.id));
    s.turn_order.retain(|id| !eliminated.contains(id));
    s.tactics_selection_order
        .retain(|id| !eliminated.contains(id));
    s.current_tactic_selector = s.tactics_selection_order.first().cloned();
    s.current_player_index = 0;
}
pub fn outcome(s: &GameState) -> Value {
    if !s.game_ended {
        return Value::Null;
    }
    let winner = s
        .players
        .iter()
        .find(|p| s.round == 4 && p.position == Some(portal()))
        .map(|p| p.id.clone());
    json!({"winner":winner,"player_results":s.players.iter().map(|p|json!({"player":p.id,"hero":p.hero,"outcome":if winner.as_ref()==Some(&p.id){"victory"}else{"defeat"}})).collect::<Vec<_>>()})
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn portal_elimination_and_victory_ignore_fame() {
        let mut s = setup(
            15,
            &[Hero::Krang, Hero::Tovak, Hero::Arythea],
            "one_to_return_3p",
        )
        .unwrap();
        s.players[1].position = Some(HexCoord::new(1, 0));
        s.players[2].position = Some(HexCoord::new(0, 1));
        s.round = 2;
        close(&mut s);
        assert_eq!(s.players.len(), 2);
        assert!(s.map.hexes[&portal().key()].site.is_none());
        s.round = 4;
        s.game_ended = true;
        s.players[0].fame = 100;
        assert!(outcome(&s)["winner"].is_null());
        s.players[1].position = Some(portal());
        assert_eq!(outcome(&s)["winner"], json!(s.players[1].id));
    }
    #[test]
    fn everyone_left_on_portal_loses() {
        let mut s = setup(15, &[Hero::Krang, Hero::Tovak], "one_to_return_2p").unwrap();
        s.round = 2;
        close(&mut s);
        assert!(s.game_ended);
        assert!(outcome(&s)["winner"].is_null());
    }
}
