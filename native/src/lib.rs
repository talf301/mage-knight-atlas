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
    GAME.with_borrow_mut(|slot|{
        if let Some(ids)=cmd.get("heroes") {
            let heroes:Vec<Hero>=serde_json::from_value(ids.clone()).map_err(|e|e.to_string())?;
            if heroes.is_empty() || heroes.len()>4 {return Err("Choose one to four heroes".into())}
            let seed=cmd["seed"].as_u64().ok_or("Missing seed")? as u32;
            let id=cmd["scenario"].as_str().ok_or("Missing scenario")?;
            let state=if id=="solo" && heroes.len()==1 {create_solo_game(seed,heroes[0])} else {
                if heroes.len()<2 {return Err("This scenario requires multiple seats".into())}
                let config=mk_data::scenarios::get_scenario(id).ok_or("Unknown scenario")?;
                create_multiplayer_game(seed,&heroes,config,id)
            };
            *slot=Some((state,UndoStack::new()));
        }
        let (s,undo)=slot.as_mut().ok_or("Start a game")?;
        let current=|s:&GameState| {
            let id=s.current_tactic_selector.as_ref().or_else(||s.turn_order.get(s.current_player_index as usize));
            s.players.iter().position(|p|Some(&p.id)==id).unwrap_or(0)
        };
        let mut events=vec![];
        if let Some(a)=cmd.get("action") {
            let i=current(s);
            let action=serde_json::from_value(a.clone()).map_err(|e|e.to_string())?;
            events=apply_legal_action(s,undo,i,&action,cmd["epoch"].as_u64().ok_or("Missing epoch")?).map_err(|e|format!("{e:?}"))?.events;
        }
        let i=current(s);
        let p=&s.players[i];
        let legal=enumerate_legal_actions_with_undo(s,i,undo);
        let view=to_client_state(s,&p.id);
        let mut cards=serde_json::Map::new();
        for id in &p.hand {
            if let Some(c)=mk_data::cards::get_card(id.as_str()){
                cards.insert(id.to_string(),json!({"name":c.name,"color":c.color,"basic":c.basic_effect,"powered":c.powered_effect}));
            }
        }
        Ok(json!({"score":s.final_score_result,"state":view,"player":i,"actions":legal.actions,"epoch":legal.epoch,"cards":cards,"events":events}))
    })
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
