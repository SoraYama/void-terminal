const navigationIcons={archive:'UI_BtnIcon_CodexBooks',compendium:'UI_BtnIcon_Bag',characters:'UI_BtnIcon_AvatarList'};
const elements=new Set(['Fire','Water','Wind','Electric','Ice','Rock','Grass']);

function GameIcon({asset,className,element}:{asset:string;className:string;element?:string}){
 const mask=`url("/assets/genshin-ui/${asset}.png")`;
 return <span className={`game-icon ${className}`} aria-hidden="true" data-element-icon={element} style={{maskImage:mask,WebkitMaskImage:mask}}/>;
}
export function NavigationIcon({module}:{module:keyof typeof navigationIcons}){return <GameIcon asset={navigationIcons[module]} className="game-navigation-icon"/>}
export function ElementIcon({element}:{element:string|null|undefined}){
 return element&&elements.has(element)?<GameIcon asset={`UI_Icon_Element_${element}`} className="character-element-icon" element={element}/>:null;
}
