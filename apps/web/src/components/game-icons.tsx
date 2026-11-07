const navigationIcons={archive:'UI_BtnIcon_CodexBooks',compendium:'UI_BtnIcon_Bag',characters:'UI_BtnIcon_AvatarList'};
const elements=new Set(['Fire','Water','Wind','Electric','Ice','Rock','Grass']);
const statIcons:Readonly<Record<string,string>>={
 BASE_HP:'UI_Icon_MaxHp',HP:'UI_Icon_MaxHp',HP_PERCENT:'UI_Icon_MaxHp',
 BASE_ATTACK:'UI_Icon_CurAttack',ATTACK:'UI_Icon_CurAttack',ATTACK_PERCENT:'UI_Icon_CurAttack',
 BASE_DEFENSE:'UI_Icon_CurDefense',DEFENSE:'UI_Icon_CurDefense',DEFENSE_PERCENT:'UI_Icon_CurDefense',
 ELEMENT_MASTERY:'UI_Icon_Element',
 CRITICAL:'UI_Icon_Critical',CRITICAL_HURT:'UI_Icon_Critical',
 CHARGE_EFFICIENCY:'UI_Icon_ChargeEfficiency',
 HEAL_ADD:'UI_Icon_Heal',HEALED_ADD:'UI_Icon_Heal',PHYSICAL_ADD_HURT:'UI_Icon_PhysicalAttackUp',
 FIRE_ADD_HURT:'UI_Icon_Element_Fire',WATER_ADD_HURT:'UI_Icon_Element_Water',WIND_ADD_HURT:'UI_Icon_Element_Wind',
 ELEC_ADD_HURT:'UI_Icon_Element_Electric',ICE_ADD_HURT:'UI_Icon_Element_Ice',ROCK_ADD_HURT:'UI_Icon_Element_Rock',GRASS_ADD_HURT:'UI_Icon_Element_Grass',
};

function GameIcon({asset,className,element}:{asset:string;className:string;element?:string}){
 const mask=`url("/assets/genshin-ui/${asset}.png")`;
 return <span className={`game-icon ${className}`} aria-hidden="true" data-element-icon={element} style={{maskImage:mask,WebkitMaskImage:mask}}/>;
}
export function NavigationIcon({module}:{module:keyof typeof navigationIcons}){return <GameIcon asset={navigationIcons[module]} className="game-navigation-icon"/>}
export function ElementIcon({element}:{element:string|null|undefined}){
 return element&&elements.has(element)?<GameIcon asset={`UI_Icon_Element_${element}`} className="character-element-icon" element={element}/>:null;
}
export function CharacterStatIcon({stat}:{stat:string}){
 const key=stat.replace(/^FIGHT_PROP_/,'');
 return Object.hasOwn(statIcons,key)?<GameIcon asset={statIcons[key]} className="character-stat-icon"/>:null;
}
export function RarityStar(){return <GameIcon asset="UI_IconStar" className="game-rarity-star"/>}
