"""Produce a component index from the Mage Knight Plus workshop BSON (decoded to JSON)."""
import json, re, sys
from pathlib import Path

def english(s):
    return re.split(r'\{[a-z-]+\}', s.replace('{en}', '', 1))[0].strip()

heroes = {'Arythea', 'Goldyx', 'Norowas', 'Tovak', 'Krang', 'Braevalar', 'Wolfhawk', 'Volkare'}
allowed = {'Spells','Advanced Actions','Ruins','Keep Garrisons','Mage Tower Garrisons','Marauding Orcs','City Garrisons','Draconum','Dungeon Monsters','Regular Units','Elite Units','Artifacts','Core Terrain Tiles','City Terrain Tiles','Countryside Terrain Tiles','Shades of Tezla','Elementalist Reward Tokens','Dark Crusader Reward Tokens','Common Pieces','All Remaining Skills'}
items = {}
piles = {}
def visit(o, path, ordinal):
    title = english(o.get('Nickname',''))
    children = o.get('ContainedObjects',[])
    if children:
        group = path + (' / ' if path else '') + (title or 'Deeds')
        for i,child in enumerate(children): visit(child, group, i)
        return
    face = o.get('CustomImage',{}).get('ImageURL') or o.get('CustomMesh',{}).get('DiffuseURL','')
    cols=rows=1
    index=0
    if 'CardID' in o:
        sheet=o.get('CustomDeck',{}).get(str(o['CardID']//100),{})
        face=sheet.get('FaceURL',face)
        cols=sheet.get('NumWidth',1)
        rows=sheet.get('NumHeight',1)
        index=o['CardID']%100
    rotation=o.get('RotationValues') or []
    if not title and rotation:title=english(str(rotation[0]['Value']))
    if title=='MapTile':title=(path or 'Starting tile')+' '+str(ordinal+1)
    if not title:title=(path.split(' / ')[-1] or 'Reference')+' '+str(ordinal+1)
    item={'name':title,'url':english(face).replace('steamusercontent-a.akamaihd.net','cdn.steamusercontent.com'),'cols':cols,'rows':rows,'index':index}
    if not item['url'].startswith('https://'):item['url']=''
    guid=o['GUID']
    alt=o.get('States',{})
    item['faces']=[v['GUID'] for v in alt.values() if v.get('GUID') and v['GUID']!=guid]
    if rotation and any('Rotation' in v for v in rotation) and 'Dice' in o['Name']:
        item['die']=[english(str(v['Value'])) for v in rotation]
    items[guid]=item
    piles.setdefault(path or 'Reference',[]).append(guid)
    for i,state in o.get('States',{}).items():
        if state.get('GUID') and state['GUID']!=guid:
            visit(state,'Alternate faces',int(i)-1)
for o in json.loads(Path(sys.argv[1]).read_text())['ObjectStates']:
    title=english(o.get('Nickname',''))
    if title in allowed or title.split(' (Components)')[0] in heroes: visit(o,'',0)
    elif re.fullmatch(r'(Day|Night) Tactic [1-6]',title) and not any(i['name']==title for i in items.values()):visit(o,title.split()[0]+' tactics',0)
    elif title=='MapTile':visit(o,'Starting tile',0)
    elif o['Name']=='Card' and title:visit(o,'Reference',0)
workshop=json.loads(Path(sys.argv[1]).read_text())
scripts=workshop.get('LuaScript','')+'\n'+'\n'.join(o.get('LuaScript','') for o in workshop['ObjectStates'])
for kind,number,guid in re.findall(r'(country|core|city)(\d+)="([a-f0-9]{6})"',scripts):
    if guid not in items: continue
    number=int(number)
    label={'country':'Countryside','core':'Core','city':'City'}[kind]
    items[guid]['name']=f'{label} tile {number}'
    items[guid]['tile']=True
    if (kind=='country' and number>14) or (kind=='core' and number>10):
        for pile in piles.values():
            if guid in pile:pile.remove(guid)
for guid,label in [('722590','Starting tile A'),('5d0bac','Starting tile B'),('835c91',"Volkare’s camp tile")]:
    if guid in items:items[guid].update(name=label,tile=True)
if '835c91' in piles['City Terrain Tiles']:
    piles['City Terrain Tiles'].remove('835c91')
    piles['Volkare (Components)'].append('835c91')
for guid,item in items.items():
    for face in item['faces'][:]:
        if face in items and guid not in items[face]['faces']:
            items[face]['faces'].append(guid)
Path(sys.argv[2]).write_text(json.dumps({'items':items,'piles':piles},separators=(',',':')))
