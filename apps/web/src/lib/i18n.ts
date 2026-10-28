import type {Locale} from './contracts';
export const labels={
 'zh-CN':{newChat:'新对话',library:'原文库',recent:'最近对话',settings:'设置',tagline:'循着原文，读懂故事与世界',title:'从一个问题，\n走进提瓦特',ask:'向虚空提问…',follow:'继续追问…',all:'全部资料',deep:'深入考据',character:'角色故事',quest:'任务脉络',book:'书籍考据',unofficial:'非官方原神知识站',sources:'来源原文',send:'发送',stop:'停止生成',loading:'正在读取…',empty:'这里还没有记录',search:'搜索书籍、任务或关键词…',status:'数据状态',close:'关闭',copy:'复制',export:'导出',delete:'删除',regenerate:'重新生成',edit:'编辑并分支',sourceLang:'资料语言',theme:'外观',light:'浅色',dark:'深色',system:'跟随系统',uiLang:'界面语言',test:'测试连接',clear:'清除本地记录',noData:'暂无匹配的原文',retry:'重试',reading:'原文阅读',askSelection:'询问这段原文',selected:'当前选中段落',readOriginal:'阅读完整原文',notice:'回答以检索到的原文为依据；综合推论仍需核对。',local:'对话仅保存在此设备',keyNote:'密钥仅保存在当前页面内存；请求时经本站后端转发给模型服务，刷新后清除。',mode:'模型连接',key:'模型 API Key',available:'可用',unavailable:'尚未就绪',previous:'上一页',next:'下一页',context:'上下文',clearKey:'清除密钥',storageError:'无法保存本地记录，请检查浏览器存储权限。'},
 en:{newChat:'New conversation',library:'Source library',recent:'Recent conversations',settings:'Settings',tagline:'Follow the sources. Discover the stories.',title:'One question.\nA world of stories.',ask:'Ask the Akasha…',follow:'Ask a follow-up…',all:'All sources',deep:'Deep research',character:'Character stories',quest:'Quest threads',book:'Books & lore',unofficial:'Unofficial Genshin knowledge archive',sources:'Original sources',send:'Send',stop:'Stop generation',loading:'Reading…',empty:'No conversations yet',search:'Search books, quests, or keywords…',status:'Corpus status',close:'Close',copy:'Copy',export:'Export',delete:'Delete',regenerate:'Regenerate',edit:'Edit & branch',sourceLang:'Source language',theme:'Appearance',light:'Light',dark:'Dark',system:'System',uiLang:'Interface language',test:'Test connection',clear:'Clear local history',noData:'No matching sources',retry:'Retry',reading:'Original text',askSelection:'Ask about selected text',selected:'Selected passage',readOriginal:'Read full document',notice:'Answers use retrieved sources; verify any interpretation against the original.',local:'Conversations stay on this device',keyNote:'Your key stays in page memory and clears on refresh. Requests pass it through this server to the model provider.',mode:'Model connection',key:'Model API key',available:'Ready',unavailable:'Not ready',previous:'Previous',next:'Next',context:'Context',clearKey:'Clear key',storageError:'Could not save history. Check browser storage permissions.'}}
export const text=(locale:Locale)=>labels[locale];

export const typeNames:Record<string,string>={quest:'任务',dialogue:'对话',book:'书籍',weapon:'武器',artifact:'圣遗物',material:'材料',furniture:'摆设',character:'角色',voice:'语音',enemy:'敌人',food:'食物',achievement:'成就',tcg:'七圣召唤',other:'其他'};

export function contextWarning(metadata:Record<string,unknown>|undefined,locale:Locale):string|null{
 if(metadata?.contextUnknown!==true)return null;
 return locale==='zh-CN'?'尚未关联到角色或任务；请勿据此推断说话人、剧情顺序或正式开放状态。':'Not yet linked to a character or quest. Do not infer speakers, story order, or official release status from this text.';
}

export function branchContextNote(metadata:Record<string,unknown>|undefined,locale:Locale){
 const candidate=metadata?.contextRelation??metadata?.relation;
 const relation=candidate&&typeof candidate==='object'&&!Array.isArray(candidate)?candidate as Record<string,unknown>:null;
 if(!relation&&metadata?.conditionUnknown!==true)return null;
 let condition:string|null=null;
 const raw=relation?.condition;
 if(typeof raw==='string'&&raw.trim())condition=raw;
 else if(raw!==undefined&&raw!==null&&typeof raw!=='string'){try{condition=JSON.stringify(raw)??null}catch{condition=null}}
 const unknown=metadata?.conditionUnknown===true||relation?.conditionUnknown===true||!condition;
 return {label:locale==='zh-CN'?'分支关联':'Related branch',kind:typeof relation?.kind==='string'?relation.kind:null,targetId:typeof relation?.targetId==='string'?relation.targetId:null,condition,conditionLabel:locale==='zh-CN'?'条件原文':'Original condition',unknownLabel:unknown?(locale==='zh-CN'?'条件未确认':'Condition unknown'):null};
}
