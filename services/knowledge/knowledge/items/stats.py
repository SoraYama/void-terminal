"""Equipment arithmetic from primary configuration; retain source precision."""
from collections import defaultdict

LABELS = {
    'BASE_ATTACK': ('Base ATK', '基础攻击力'), 'HP': ('HP', '生命值'),
    'ATTACK': ('ATK', '攻击力'), 'DEFENSE': ('DEF', '防御力'),
    'HP_PERCENT': ('HP', '生命值'), 'ATTACK_PERCENT': ('ATK', '攻击力'),
    'DEFENSE_PERCENT': ('DEF', '防御力'), 'CRITICAL': ('CRIT Rate', '暴击率'),
    'CRITICAL_HURT': ('CRIT DMG', '暴击伤害'), 'CHARGE_EFFICIENCY': ('Energy Recharge', '元素充能效率'),
    'ELEMENT_MASTERY': ('Elemental Mastery', '元素精通'), 'HEAL_ADD': ('Healing Bonus', '治疗加成'),
    'FIRE_ADD_HURT': ('Pyro DMG Bonus', '火元素伤害加成'), 'WATER_ADD_HURT': ('Hydro DMG Bonus', '水元素伤害加成'),
    'ICE_ADD_HURT': ('Cryo DMG Bonus', '冰元素伤害加成'), 'ELEC_ADD_HURT': ('Electro DMG Bonus', '雷元素伤害加成'),
    'WIND_ADD_HURT': ('Anemo DMG Bonus', '风元素伤害加成'), 'ROCK_ADD_HURT': ('Geo DMG Bonus', '岩元素伤害加成'),
    'GRASS_ADD_HURT': ('Dendro DMG Bonus', '草元素伤害加成'), 'PHYSICAL_ADD_HURT': ('Physical DMG Bonus', '物理伤害加成'),
}
FLAT = {'FIGHT_PROP_BASE_ATTACK','FIGHT_PROP_HP','FIGHT_PROP_ATTACK','FIGHT_PROP_DEFENSE','FIGHT_PROP_ELEMENT_MASTERY'}
# FightProp enum IDs used by the primary slot-selection schema. Keep an explicit
# mapping: unknown future numeric IDs must never become fabricated stat labels.
FIGHT_PROP_IDS={2:'HP',3:'HP_PERCENT',5:'ATTACK',6:'ATTACK_PERCENT',8:'DEFENSE',9:'DEFENSE_PERCENT',
    20:'CRITICAL',22:'CRITICAL_HURT',23:'CHARGE_EFFICIENCY',26:'HEAL_ADD',28:'ELEMENT_MASTERY',
    30:'PHYSICAL_ADD_HURT',40:'FIRE_ADD_HURT',41:'ELEC_ADD_HURT',42:'WATER_ADD_HURT',
    43:'GRASS_ADD_HURT',44:'WIND_ADD_HURT',45:'ROCK_ADD_HURT',46:'ICE_ADD_HURT'}


def stat(key, value, language):
    suffix=key.removeprefix('FIGHT_PROP_')
    label=LABELS.get(suffix,(suffix.replace('_',' ').title(),suffix))[language=='zh-CN']
    return {'key':key,'label':label,'value':value if key in FLAT else value*100,'unit':'' if key in FLAT else '%'}


def weapon_levels(row, curves, promotions, language, completeness=None):
    levels=[]
    phases=[]
    required_props={p.get('propType') for p in row.get('weaponProp',[]) if p.get('propType')}
    valid_definitions=all('initValue' in p and p.get('type') for p in row.get('weaponProp',[]) if p.get('propType'))
    previous_cap=1
    for promotion in sorted(promotions,key=lambda r:r.get('promoteLevel',0)):
        cap=promotion.get('unlockMaxLevel',0)
        phase=promotion.get('promoteLevel',0)
        expected_levels=set(range(previous_cap,cap+1))
        resolved={}
        additions={p.get('propType'):p.get('value',0) for p in promotion.get('addProps',[]) if p.get('propType')}
        for level in range(previous_cap,cap+1):
            if level not in curves:continue
            stats=[]
            for prop in row.get('weaponProp',[]):
                key=prop.get('propType');curve=curves[level].get(prop.get('type'))
                if not key or curve is None or 'initValue' not in prop or 'value' not in curve:continue
                base=prop['initValue']
                arith=curve.get('arith','ARITH_MULTI')
                if arith=='ARITH_MULTI':value=base*curve['value']
                elif arith=='ARITH_ADD':value=base+curve['value']
                else:continue
                stats.append(stat(key,value+additions.get(key,0),language))
            if stats:
                levels.append({'level':level,'ascension':phase,'stats':stats})
                resolved[level]={s['key'] for s in stats}
        missing_props=[{'level':level,'keys':sorted(required_props-resolved.get(level,set()))}
                       for level in sorted(expected_levels) if required_props-resolved.get(level,set())]
        phases.append({'phase':phase,'expectedLevels':sorted(expected_levels),'resolvedLevels':sorted(resolved),
                       'missingProperties':missing_props,
                       'complete':bool(required_props and expected_levels) and not missing_props})
        previous_cap=cap
    if completeness is not None:
        phase_ids=[p['phase'] for p in phases]
        contiguous=bool(phase_ids) and phase_ids==list(range(max(phase_ids)+1))
        completeness.update(complete=valid_definitions and contiguous and all(p['complete'] for p in phases),phases=phases)
    return levels


def artifact_rules(variants, tables, language, completeness=None):
    rules=[]
    rarities=[]
    for rarity in sorted({r.get('rankLevel',1) for r in variants}):
        rows=[r for r in variants if r.get('rankLevel',1)==rarity]
        max_level=max(r.get('maxLevel',1)-1 for r in rows)
        main_depots={r.get('mainPropDepotId') for r in rows}
        sub_depots={r.get('appendPropDepotId') for r in rows}
        allowed={p['propType'] for p in tables['ReliquaryMainProp'] if p.get('propDepotId') in main_depots and p.get('propType')}
        equip_type=rows[0].get('equipType')
        scheme=next((s for s in tables.get('ReliquarySetSchemeMainProp',[]) if s.get('equipType')==equip_type),None)
        slot_props=set();ids=[]
        if scheme is not None:
            # These two fields are observed at the pinned commit; do not guess
            # other opaque fields or equate every generic depot entry to a drop.
            ids=scheme.get('CBFOCJNNOGG',[])+scheme.get('DPKIBDILFGI',[])
            slot_props={'FIGHT_PROP_'+FIGHT_PROP_IDS[i] for i in ids if i in FIGHT_PROP_IDS}
        # A generic depot includes properties that cannot be selected in this
        # physical slot. Missing selection data must never widen the legal pool.
        allowed &= slot_props
        main=defaultdict(list)
        for level in tables['ReliquaryLevel']:
            ui_level=level.get('level',1)-1
            if level.get('rank',1)!=rarity or not 0<=ui_level<=max_level:continue
            for prop in level.get('addProps',[]):
                if prop.get('propType') in allowed:
                    value=stat(prop['propType'],prop.get('value',0),language)
                    main[prop['propType']].append({'level':ui_level,'value':value['value']})
        subs=defaultdict(set)
        for prop in tables['ReliquaryAffix']:
            if prop.get('depotId') in sub_depots and prop.get('propType'):
                # Fixed flower/plume mains cannot also occur as a substat.
                if len(allowed)==1 and prop['propType'] in allowed:continue
                subs[prop['propType']].add(stat(prop['propType'],prop.get('propValue',0),language)['value'])
        def group(key,values):
            info=stat(key,0,language);info.pop('value');return {**info,'values':values}
        rules.append({'rarity':rarity,'maxLevel':max_level,
            'mainStats':[group(key,sorted(values,key=lambda r:r['level'])) for key,values in sorted(main.items())],
            'substats':[group(key,sorted(values)) for key,values in sorted(subs.items())]})
        expected_levels=set(range(max_level+1))
        missing_props=[{'key':key,'levels':sorted(expected_levels-{v['level'] for v in main[key]})}
                       for key in sorted(slot_props) if expected_levels-{v['level'] for v in main[key]}]
        rarities.append({'rarity':rarity,'expectedLevels':sorted(expected_levels),
            'resolvedLevels':{key:sorted(v['level'] for v in values) for key,values in main.items()},
            'missingProperties':missing_props,
            'complete':bool(slot_props and expected_levels) and allowed==slot_props
                       and all(i in FIGHT_PROP_IDS for i in ids) and not missing_props})
    if completeness is not None:completeness.update(complete=bool(rarities) and all(r['complete'] for r in rarities),rarities=rarities)
    return rules
