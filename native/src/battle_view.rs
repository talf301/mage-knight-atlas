use mk_data::enemies::{attack_count, get_enemy};
use mk_engine::{
    combat_resolution::{
        calculate_effective_block, effective_city_color_for_enemy, get_enemy_attack_info_with_city,
    },
    legal_actions::combat::eligible_attack_targets,
};
use mk_types::{
    enums::{CombatPhase, CombatType},
    pending::{ActivePending, SubsetSelectionKind},
    state::GameState,
};
use serde_json::{json, Value};

/// Project the engine's target index and elemental block calculation onto visible foes.
pub fn view(state: &GameState, player_idx: usize) -> Value {
    let Some(combat) = &state.combat else {
        return Value::Null;
    };
    let player = &state.players[player_idx];
    let mut targets = Vec::new();
    match &player.pending.active {
        Some(ActivePending::SubsetSelection(selection)) => {
            if let SubsetSelectionKind::AttackTargets {
                eligible_instance_ids,
                ..
            } = &selection.kind
            {
                targets = eligible_instance_ids.clone();
            }
        }
        None if combat.declared_attack_targets.is_none() => {
            let attack_type = match combat.phase {
                CombatPhase::RangedSiege => Some(CombatType::Siege),
                CombatPhase::Attack => Some(CombatType::Melee),
                _ => None,
            };
            if let Some(kind) = attack_type {
                targets = eligible_attack_targets(
                    combat,
                    kind,
                    &state.active_modifiers,
                    Some(player.id.as_str()),
                );
            }
        }
        _ => {}
    }
    let mut blocks = serde_json::Map::new();
    if combat.phase == CombatPhase::Block {
        for enemy in combat.enemies.iter().filter(|e| !e.is_defeated) {
            let Some(def) = get_enemy(enemy.enemy_id.as_str()) else {
                continue;
            };
            let city = effective_city_color_for_enemy(combat, enemy);
            let mut rows = Vec::new();
            for i in 0..attack_count(def) {
                if enemy.attacks_blocked.get(i) == Some(&true)
                    || enemy.attacks_cancelled.get(i) == Some(&true)
                {
                    continue;
                }
                let (damage, element, swift) = get_enemy_attack_info_with_city(def, i, city);
                if damage == 0 {
                    continue;
                }
                let required = if swift { damage * 2 } else { damage };
                let effective =
                    calculate_effective_block(&player.combat_accumulator.block_elements, element);
                rows.push(
                    json!({"attack":i,"required":required,"effective":effective,"element":element}),
                );
            }
            blocks.insert(enemy.instance_id.to_string(), json!(rows));
        }
    }
    json!({"targets":targets,"blocks":blocks})
}
