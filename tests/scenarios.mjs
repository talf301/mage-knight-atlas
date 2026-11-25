import fs from 'node:fs';
import {engine} from '../web/engine.mjs';
const run=await engine(fs.readFileSync(new URL('../web/atlas.wasm',import.meta.url)));
for(const scenario of ['dungeon_lords','mines_liberation','druid_nights']){
for(const n of [2,3,4]){
let g=run({setupVersion:3,heroes:['arythea','goldyx','tovak','krang'].slice(0,n),scenario:scenario+'_'+n+'p',seed:42});
let i=0;
while(!g.state.gameEnded&&i++<1200){
const choices=g.actions.filter(a=>a!=='Undo');
const kind=a=>typeof a==='string'?a:Object.keys(a)[0];
const a=['PlaceEntrance','AnnounceEndOfRound','EndTurn','EndRest','SelectTactic','DeclareRest','Rest','PlayCardSideways','PlayCardBasic'].map(k=>choices.find(a=>kind(a)===k)).find(Boolean)||choices[0];
g=run({action:a,epoch:g.epoch});
}
if(!g.state.gameEnded||!g.score)throw Error(scenario+' did not score');
console.log(scenario,n,i,g.state.round);
}}
