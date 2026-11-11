'use strict';

const D = JSON.parse(document.querySelector('#atlas-data').textContent);
const $ = id => document.getElementById(id);
const canvas = $('map');
const mapSurface = canvas.parentElement;
const context = canvas.getContext('2d');
const sceneNames = {teyvat:'提瓦特',fontaine:'枫丹全图',castle:'褪色古堡',sea:'旧日之海',enkanomiya:'渊下宫',chasm:'层岩巨渊',sacred:'远古圣山',space:'空之神殿',moon:'霜月'};
const areaNames = {mondstadt:'蒙德',liyue:'璃月',inazuma:'稻妻',sumeru:'须弥',fontaine:'枫丹',natlan:'纳塔',snezhnaya:'至冬'};
const groupNames = {all:'全部',material:'突破材料',oculus:'神瞳',chest:'宝箱',mora:'摩拉',entrance:'入口与锚点',enemy:'敌人与首领',puzzle:'解谜',other:'其他资源'};
const symbols = {material:'✿',oculus:'◆',chest:'▣',mora:'●',entrance:'↗',enemy:'⚔',puzzle:'◇',other:'·'};
const colors = {material:'#b7db8d',oculus:'#77d2f7',chest:'#f5bd7d',mora:'#f5d762',entrance:'#e0c6ff',enemy:'#ffb7a0',puzzle:'#aee2cb',other:'#e1e0d2'};
const aliases = {
  127:'摩拉袋 金币 钱袋',366:'摩拉袋 藏物箱 摩拉箱 金币',508:'神瞳 水瞳',
  17:'普通宝箱',44:'精致宝箱',45:'珍贵宝箱',46:'华丽宝箱',269:'奇馈箱',
  500:'突破材料 区域特产',501:'突破材料 区域特产',502:'突破材料 区域特产',
  503:'突破材料 区域特产',545:'突破材料 区域特产',546:'突破材料 区域特产',
  548:'突破材料 区域特产',549:'突破材料 区域特产',
};
const fmt = new Intl.NumberFormat('zh-CN');
const state = {
  scene:'teyvat',region:'',floor:0,filter:'oculus',type:'',query:'',showAccess:true,selected:null,limit:120,
  cx:0,cy:0,scale:0,baseline:1,w:0,h:0,dpr:1,
  hd:D.onlineHD!==false,
};
const images = new Map();
// Only the current viewport is requested. Completed bitmaps have a bounded LRU;
// stale requests are aborted and the embedded pyramid remains visible underneath.
const hdTiles = new Map();
const HD_LIMIT = 256, HD_CONCURRENCY = 6;
const fontaineIds=new Set(D.fontaineIds);
let frame = 0, resultPoints = [], mapTargets = [];
const pointers = new Map();
let dragged = false;

const clamp = (v,min,max) => Math.min(max,Math.max(min,v));
const latY = lat => -Math.asinh(Math.tan(lat*Math.PI/180))*180/Math.PI;
const sceneMap = () => D.maps[['fontaine','castle'].includes(state.scene)?'teyvat':state.scene];
const activeFloor = () => sceneMap().floors[state.floor];
const isResource = p => p.kind !== 'entrance';
const boundsY = (west,south,east,north) => [west,latY(north),east,latY(south)];
const floorBounds = ({west,south,east,north}) => boundsY(west,south,east,north);
const point = (x,y) => [(x-state.cx)*state.scale+state.w/2,(y-state.cy)*state.scale+state.h/2];
const centerWorld = (x,y) => [(x-state.w/2)/state.scale+state.cx,(y-state.h/2)/state.scale+state.cy];

for (const m of Object.values(D.maps)) {
  m.byId = new Map();
  m.points = m.points.map(([id,t,x,lat,floor,entrances,group]) => {
    const [name,en,kind] = D.types[t];
    const p = {id,t,x,y:latY(lat),floor,entrances,group,name,en,kind};
    const location = group===129?'褪色古堡':m.name;
    p.search = [id,name,en,kind==='entrance'?'入口':groupNames[kind],aliases[t],location,m.floors[floor]?.name].filter(Boolean).join(' ').toLowerCase();
    m.byId.set(id,p);
    return p;
  });
  const order=['oculus','material','chest','mora','entrance','enemy','puzzle','other'];
  m.points.sort((a,b) => order.indexOf(a.kind)-order.indexOf(b.kind) || a.id-b.id);
}

function currentPool() {
  if (state.scene==='castle') return sceneMap().points.filter(p=>p.group===129 && p.floor===state.floor);
  if (state.floor) return sceneMap().points.filter(p=>p.floor===state.floor);
  if (state.scene==='fontaine') return sceneMap().points.filter(p=>fontaineIds.has(p.id));
  return sceneMap().points;
}
function getResults() {
  const words=state.query.toLowerCase().trim().split(/\s+/u).filter(Boolean).map(s=>s.replace(/^#/,''));
  return currentPool().filter(p => (state.filter==='all' ? (words.length || isResource(p)) : p.kind===state.filter)
    && (!state.type || p.t===Number(state.type))
    && (!isPointQuery() || p.id===Number(state.query.trim().replace(/^#/,'')))
    && words.every(w=>p.search.includes(w)));
}
function detailLocation(p) {
  const floor = sceneMap().floors[p.floor];
  if (p.group===129 && floor) return '褪色古堡 · '+floor.name;
  if (floor) return sceneMap().name+' · '+floor.name;
  if (p.floor) return '楼层图待补';
  return state.scene==='fontaine'?'枫丹':sceneMap().name;
}
const isPointQuery = () => /^#?\d+$/.test(state.query.trim());
function renderResults() {
  const exact=isPointQuery();
  $('group-note').hidden=exact || !resultPoints.length;
  if(!resultPoints.length) {
    $('results').innerHTML='<p class="empty">没有找到匹配的标点。试试其他分类或楼层。</p>';
    canvas.dataset.groups='0';return;
  }
  if(exact) {
    $('results').innerHTML=resultPoints.slice(0,state.limit).map(p=>
      '<button type="button" class="result" data-point="'+p.id+'" aria-current="'+String(state.selected?.id===p.id)+'">'+(D.icons[p.t]?'<img class="item-icon" alt="" src="'+D.icons[p.t]+'">':'')+'<span><strong>'+escapeHTML(p.name)+'</strong><small>'+escapeHTML(detailLocation(p))+' · #'+p.id+'</small></span><span class="chevron" aria-hidden="true">›</span></button>'
    ).join('');
    canvas.dataset.groups='0';return;
  }
  const groups=new Map();
  for(const p of resultPoints) {
    if(!groups.has(p.t))groups.set(p.t,{point:p,count:0});
    groups.get(p.t).count++;
  }
  canvas.dataset.groups=String(groups.size);
  $('result-count').textContent=fmt.format(groups.size)+' 类 · '+fmt.format(resultPoints.length)+' 处';
  $('group-note').innerHTML=state.type?'<button type="button" id="clear-type">返回全部'+(groupNames[state.filter]==='全部'?'资源':groupNames[state.filter])+'</button>':'按类型聚合，点击地图标点查看详情。';
  $('results').innerHTML=[...groups.values()].slice(0,state.limit).map(({point:p,count})=>
    '<button type="button" class="result resource-group" data-resource-type="'+p.t+'" aria-pressed="'+String(state.type===String(p.t))+'">'+(D.icons[p.t]?'<img class="item-icon" alt="" src="'+D.icons[p.t]+'">':'')+'<span><strong>'+escapeHTML(p.name)+'</strong><small>'+escapeHTML(state.scene==='fontaine'?'枫丹':state.floor?detailLocation(p):sceneNames[state.scene])+'</small></span><span class="group-count">'+fmt.format(count)+'<small>处</small></span></button>'
  ).join('')+(groups.size>state.limit?'<button type="button" id="more-results" class="more-results">显示更多资源类型（'+state.limit+' / '+groups.size+'）</button>':'');
}
function syncPanels() {
  resultPoints=getResults();
  canvas.dataset.count=String(resultPoints.length);
  $('map-select').value=['enkanomiya','chasm','sea','sacred','space','moon','castle'].includes(state.scene)?state.scene:'';
  $('region-select').value=state.region;
  for(const b of $('region-tabs').querySelectorAll('button')) {
    const active=b.dataset.scene==='teyvat'?state.scene==='teyvat'&&!state.region:
      !state.floor&&sceneMap().id===2&&b.dataset.region===state.region;
    b.setAttribute('aria-pressed',String(active));
  }
  for (const b of document.querySelectorAll('[data-filter]')) b.setAttribute('aria-pressed',String(b.dataset.filter===state.filter));
  $('scene-tag').textContent=state.floor?'分层地图':sceneMap().id===2?'提瓦特 · 7.2':'独立场景 · 7.2';
  const title=!state.floor&&state.region?areaNames[state.region]:sceneNames[state.scene];
  $('scene-title').textContent=title;
  canvas.setAttribute('aria-label',title+'地图，可用方向键移动，用加减号缩放');
  $('scene-hint').textContent=state.scene==='castle'?activeFloor().name+' 楼层':state.floor?activeFloor().name+' 楼层':'资源与探索标点';
  $('floors').hidden=!activeFloor();
  $('access-switch').hidden=!activeFloor();
  $('region-control').hidden=sceneMap().id!==2 || !!state.floor;
  if(activeFloor()) {
    $('floors').replaceChildren(...Object.values(sceneMap().floors).filter(f=>f.groupId===activeFloor().groupId).map(f=>{
      const b=document.createElement('button');
      b.type='button'; b.textContent=f.name; b.dataset.floor=f.id;
      b.setAttribute('aria-pressed',String(state.floor===f.id)); return b;
    }));
  }
  $('result-count').textContent=fmt.format(resultPoints.length)+' 处';
  $('results-label').textContent=isPointQuery()?'标点查询':state.query.trim()?'匹配的资源':state.filter==='all'?'资源类型':groupNames[state.filter]+'类型';
  const available=new Set(currentPool().filter(p=>state.filter==='all'||p.kind===state.filter).map(p=>p.t));
  $('type-select').innerHTML='<option value="">全部资源类型</option>'+[...available].sort((a,b)=>D.types[a][0].localeCompare(D.types[b][0],'zh')).map(t=>'<option value="'+t+'">'+escapeHTML(D.types[t][0])+'</option>').join('');
  $('type-select').value=state.type;
  $('filter-note').hidden=!['material','enemy','puzzle'].includes(state.filter);
  $('filter-note').textContent=({material:'当前显示区域特产；掉落来源可查看「敌人与首领」。',enemy:'标记敌人的出现位置，掉落物需击败后获取。',puzzle:'解谜标记数量不等同于可开启的宝箱数量。'})[state.filter]||'';
  renderResults();
  $('results').scrollTop=0;
  syncDetail();
  schedule();
}
function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function syncDetail() {
  const p=state.selected;
  $('detail').hidden=!p;
  if (!p) { $('detail').replaceChildren(); return; }
  const m=sceneMap();
  const refs=p.entrances.map(id=>m.byId.get(id)).filter(Boolean);
  const floor=m.floors[p.floor];
  const links=refs.map(r=>'<button type="button" data-ref="'+r.id+'">'+escapeHTML(r.name)+' #'+r.id+'</button>');
  if (floor && !state.floor) links.push('<button type="button" data-see-floor="'+floor.id+'">查看所在楼层</button>');
  if (state.floor && state.scene!=='castle') links.push('<button type="button" data-see-floor="0">返回场景全图</button>');
  links.push('<a target="_blank" rel="noopener noreferrer" href="https://genshin-impact-map.appsample.com/?id='+p.id+'&amp;mid='+m.id+'&amp;type=o'+p.t+'">查看原标点 ↗</a>');
  $('detail').innerHTML='<div class="detail-top">'+(D.icons[p.t]?'<img alt="" class="detail-icon" src="'+D.icons[p.t]+'">':'')+'<h3>'+escapeHTML(p.name)+'</h3><button class="detail-close" data-close type="button" aria-label="关闭详情">×</button></div>'
    +'<p>'+escapeHTML(detailLocation(p))+' · #'+p.id+(refs.length?' · '+refs.length+' 个入口指引':'')+'</p>'
    +'<div class="detail-links">'+links.join('')+'</div>';
}
function markSelected() {
  for (const b of $('results').querySelectorAll('[aria-current="true"]')) b.setAttribute('aria-current','false');
  if (state.selected) $('results').querySelector('[data-point="'+state.selected.id+'"]')?.setAttribute('aria-current','true');
  syncDetail();
  schedule();
}
function selectPoint(p,focus=true,viaAccess=false) {
  if (!p) return;
  if (!viaAccess && p.group===129 && (state.scene!=='castle' || state.floor!==p.floor)) {
    setScene('castle',p.floor);
  }
  state.selected=p;
  if (focus) {
    state.cx=p.x; state.cy=p.y;
    state.scale=Math.min(maxScale(),Math.max(state.scale,state.baseline*(state.scene==='castle'?1:3.1)));
    if (state.scene==='castle' && !viaAccess && state.showAccess) {
      const anchors=[p,...p.entrances.map(id=>sceneMap().byId.get(id)).filter(Boolean)];
      if(anchors.length>1) {
        const xs=anchors.map(a=>a.x),ys=anchors.map(a=>a.y);
        const left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
        const compact=state.w<510;
        const safeX1=compact?26:235,safeX2=state.w-60,safeY1=compact?184:112,safeY2=state.h-46;
        state.scale=Math.min(state.scale,(safeX2-safeX1)/Math.max(right-left,1e-7),(safeY2-safeY1)/Math.max(bottom-top,1e-7));
        state.cx=(left+right)/2-((safeX1+safeX2-state.w)/2)/state.scale;
        state.cy=(top+bottom)/2-((safeY1+safeY2-state.h)/2)/state.scale;
      }
    }
    constrain();
  }
  markSelected();
}
function setScene(scene,floor) {
  if(!sceneNames[scene]) return;
  const previousScene=state.scene;
  state.scene=scene;
  state.region=scene==='fontaine'?'fontaine':'';
  state.floor=scene==='castle'?(floor||162):(floor||0);
  state.selected=null;
  if(previousScene!==scene) state.type='';
  state.limit=120;
  resetView();
  syncPanels();
}
function setRegion(region) {
  const area=D.maps.teyvat.areas.find(a=>a.id===region);
  if(!area) {setScene('teyvat');return;}
  if(region==='fontaine') {setScene('fontaine');return;}
  setScene('teyvat');
  state.region=region;
  state.cx=area.center.x;state.cy=latY(area.center.y);state.scale=256*2**area.zoom/360;
  syncPanels();
}
function fitResults() {
  if(!resultPoints.length) return;
  if(resultPoints.length===1) {selectPoint(resultPoints[0]);return;}
  const xs=resultPoints.map(p=>p.x),ys=resultPoints.map(p=>p.y);
  let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
  for(let i=0;i<xs.length;i++) {left=Math.min(left,xs[i]);right=Math.max(right,xs[i]);top=Math.min(top,ys[i]);bottom=Math.max(bottom,ys[i]);}
  state.cx=(left+right)/2;state.cy=(top+bottom)/2;
  state.scale=clamp(Math.min((state.w-80)/Math.max(right-left,.002),(state.h-100)/Math.max(bottom-top,.002)),state.baseline*.72,maxScale());
  constrain();schedule();
}
function fittedView() {
  if (activeFloor()) {
    const b=floorBounds(activeFloor().bounds);
    const refs=entrancePoints();
    if(state.scene==='castle') for(const p of refs) {
      b[0]=Math.min(b[0],p.x);b[1]=Math.min(b[1],p.y);b[2]=Math.max(b[2],p.x);b[3]=Math.max(b[3],p.y);
    }
    const compact=state.w<510;
    return {cx:(b[0]+b[2])/2,cy:(b[1]+b[3])/2-(b[3]-b[1])*(compact?.25:.1),
      scale:Math.min(Math.max(100,state.w-52)/(b[2]-b[0]),Math.max(120,state.h-(compact?172:168))/(b[3]-b[1]))*.84};
  }
  const [x1,y1,x2,y2]=boundsY(...(state.scene==='fontaine'?[.003,.086,.237,.454]:sceneMap().initial));
  return {cx:(x1+x2)/2,cy:(y1+y2)/2,scale:Math.min((state.w-40)/(x2-x1),(state.h-52)/(y2-y1))};
}
function resetView() {
  if (!state.w || !state.h) return;
  Object.assign(state,fittedView());
  state.baseline=state.scale;
  schedule();
}
const maxScale=()=>state.baseline*(state.scene==='castle'?5.5:17);
function constrain() {
  const [w,n,e,s]=boundsY(...sceneMap().bounds);
  const px=Math.min((e-w)*.22,state.w/state.scale*.22);
  const py=Math.min((s-n)*.22,state.h/state.scale*.22);
  state.cx=clamp(state.cx,w-px,e+px);
  state.cy=clamp(state.cy,n-py,s+py);
}
function zoomAt(f,x=state.w/2,y=state.h/2) {
  const [u,v]=centerWorld(x,y);
  state.scale=clamp(state.scale*f,state.baseline*.72,maxScale());
  state.cx=u-(x-state.w/2)/state.scale;
  state.cy=v-(y-state.h/2)/state.scale;
  constrain();
  schedule();
}
function entrancePoints() {
  if (!state.floor || !state.showAccess) return [];
  const refs=new Set(currentPool().flatMap(p=>p.entrances));
  return [...refs].map(id=>sceneMap().byId.get(id)).filter(Boolean);
}
function syncSize() {
  const rect=canvas.getBoundingClientRect();
  const initial=!state.scale;
  const wasZoom=initial?1:state.scale/state.baseline;
  state.w=rect.width; state.h=rect.height; state.dpr=Math.min(2.5,window.devicePixelRatio||1);
  if(!state.w||!state.h) return;
  canvas.width=Math.round(state.w*state.dpr);canvas.height=Math.round(state.h*state.dpr);
  if(initial) resetView();
  else {
    state.baseline=fittedView().scale;
    state.scale=clamp(state.baseline*wasZoom,state.baseline*.72,maxScale());
    schedule();
  }
}
function schedule() { if(!frame) frame=requestAnimationFrame(draw); }
function loadImage(key,src) {
  if (!src) return null;
  if (!images.has(key)) {
    const im=new Image();
    im.onload=schedule;
    im.onerror=schedule;
    images.set(key,im);
    im.src=src;
  }
  const im=images.get(key);
  return im.complete && im.naturalWidth?im:null;
}
function drawTiles() {
  const m=sceneMap(), levels=Object.keys(m.tiles).map(Number).sort((a,b)=>a-b), native=m.nativeTiles;
  const online=state.hd && native && !activeFloor();
  const desired=Math.ceil(Math.log2(state.scale*state.dpr*360/256));
  let target=clamp(desired,levels[0],online?native.maxZoom:levels.at(-1));
  // Keep even very large/high-DPI displays inside the bitmap budget.
  while(online && target>levels[0]) {
    const size=360/2**target*state.scale;
    if((Math.ceil(state.w/size)+1)*(Math.ceil(state.h/size)+1)<=HD_LIMIT-HD_CONCURRENCY) break;
    target--;
  }
  let draws=0;
  const [u,v]=centerWorld(0,0),[uu,vv]=centerWorld(state.w,state.h);
  for(const z of levels) {
    if(z>target) break;
    const world=360/2**z;
    const size=world*state.scale;
    for(let x=Math.floor(u/world);x<=Math.floor(uu/world);x++) {
      for(let y=Math.floor(v/world);y<=Math.floor(vv/world);y++) {
        const key=x+','+y;
        const im=loadImage(m.id+':'+z+':'+key,m.tiles[z][key]);
        if(!im) continue;
        const [sx,sy]=point(x*world,y*world);
        context.drawImage(im,sx,sy,size+.4,size+.4);
        draws++;
      }
    }
  }
  const wanted=new Map();
  let ready=0,failed=0;
  if(online) {
    const world=360/2**target,size=world*state.scale,lim=native.tileBounds?.[target];
    const entries=[];
    for(let x=Math.floor(u/world);x<=Math.floor(uu/world);x++) {
      for(let y=Math.floor(v/world);y<=Math.floor(vv/world);y++) {
        const sy=-y-1;
        if(lim && (x<lim.minX || x>lim.maxX || sy<lim.minY || sy>lim.maxY)) continue;
        const tileKey=x+','+y;
        if(m.tiles[target]?.[tileKey]) continue;
        const key=m.id+':'+target+':'+tileKey;
        const url=native.urlTemplate.replace('{z}',target).replace('{x}',x).replace('{y}',sy);
        entries.push({key,url,x,y,distance:(x+.5-state.cx/world)**2+(y+.5-state.cy/world)**2});
      }
    }
    entries.sort((a,b)=>a.distance-b.distance);
    for(const {key,url,x,y} of entries) {
      wanted.set(key,url);
      const tile=hdTiles.get(key);
      if(tile?.status==='ready') {
        const [sx,sy]=point(x*world,y*world);
        context.drawImage(tile.image,sx,sy,size+.4,size+.4);
        hdTiles.delete(key);hdTiles.set(key,tile);
        ready++;draws++;
      } else if(tile?.status==='error') failed++;
    }
  }
  updateHDTiles(wanted);
  canvas.dataset.tileStatus=activeFloor()?'floor':!state.hd?'offline':failed?'fallback':ready<wanted.size?'loading':'ready';
  canvas.dataset.hdReady=String(ready);
  canvas.dataset.hdWanted=String(wanted.size);
  canvas.dataset.hdFailed=String(failed);
  canvas.dataset.tileLevel=String(target);
  return draws;
}
function updateHDTiles(wanted) {
  for(const [key,tile] of hdTiles) {
    if(tile.status==='loading' && !wanted.has(key)) {
      tile.abort.abort();hdTiles.delete(key);
    }
  }
  let pending=[...hdTiles.values()].filter(t=>t.status==='loading').length;
  for(const [key,url] of wanted) {
    if(pending>=HD_CONCURRENCY) break;
    if(hdTiles.has(key)) continue;
    const tile={status:'loading',abort:new AbortController()};
    hdTiles.set(key,tile);pending++;
    const timeout=setTimeout(()=>tile.abort.abort(),12000);
    fetch(url,{signal:tile.abort.signal,mode:'cors',credentials:'omit'})
      .then(r=>{if(!r.ok)throw Error('Tile '+r.status);return r.blob();})
      .then(blob=>createImageBitmap(blob))
      .then(im=>{
        if(hdTiles.get(key)!==tile) {im.close();return;}
        tile.image=im;tile.status='ready';
      })
      .catch(()=>{if(hdTiles.get(key)===tile)tile.status='error';})
      .finally(()=>{clearTimeout(timeout);schedule();});
  }
  for(const [key,tile] of hdTiles) {
    if(hdTiles.size<=HD_LIMIT) break;
    if(wanted.has(key) || tile.status==='loading') continue;
    tile.image?.close();hdTiles.delete(key);
  }
}
function drawFloor() {
  const floor=activeFloor();
  if (!floor) return '';
  context.fillStyle='#12232fae';
  context.fillRect(0,0,state.w,state.h);
  const [w,n,e,s]=floorBounds(floor.bounds),[x,y]=point(w,n),[xx,yy]=point(e,s);
  const image=loadImage('floor:'+sceneMap().id+':'+floor.id,floor.image);
  if (!image) return 'loading';
  context.drawImage(image,x,y,xx-x,yy-y);
  return 'ready';
}
function drawGlyph(kind,x,y,r=8,selected=false,resource=null) {
  const c=context;
  const icon=resource && loadImage('icon:'+resource.t,D.icons[resource.t]);
  if(icon) {
    const size=selected?37:29;
    if(selected) {
      c.beginPath();c.arc(x,y,23,0,Math.PI*2);c.fillStyle='#fff5d645';c.fill();
      c.strokeStyle='#fff2ba';c.lineWidth=1.5;c.stroke();
    }
    c.save();c.shadowColor='#09293bcc';c.shadowBlur=3;c.shadowOffsetY=1;
    c.drawImage(icon,x-size/2,y-size/2,size,size);c.restore();
    return;
  }
  c.save();c.translate(x,y);
  if(selected) {
    c.beginPath();c.arc(0,0,r+5,0,Math.PI*2);c.fillStyle='#fff5d662';c.fill();
    c.strokeStyle='#fff5d6';c.lineWidth=1.5;c.stroke();
  }
  c.beginPath();
  if(kind==='oculus') { c.moveTo(0,-r-1);c.lineTo(r*.82,0);c.lineTo(0,r+1);c.lineTo(-r*.82,0);c.closePath(); }
  else if(kind==='chest') { c.roundRect(-r,-r*.75,r*2,r*1.5,3); }
  else c.arc(0,0,r,0,Math.PI*2);
  c.fillStyle=colors[kind];c.fill();
  c.strokeStyle='#1e3949';c.lineWidth=1.5;c.stroke();
  c.fillStyle='#223c4b';c.strokeStyle='#223c4b';c.lineWidth=1.1;
  if(kind==='oculus') { c.beginPath();c.arc(0,0,1.7,0,Math.PI*2);c.fill(); }
  if(kind==='mora') { c.beginPath();c.arc(0,0,r*.43,0,Math.PI*2);c.stroke(); }
  if(kind==='chest') { c.beginPath();c.moveTo(-r,0);c.lineTo(r,0);c.stroke();c.fillRect(-1,-1,2,3); }
  if(kind==='material') { c.beginPath();c.ellipse(0,0,2.7,4.7,Math.PI/4,0,Math.PI*2);c.fill(); }
  if(kind==='entrance') {c.font='bold 13px system-ui';c.textAlign='center';c.textBaseline='middle';c.fillText(symbols[kind],0,0);}
  c.restore();
}
function drawResources() {
  const selected=state.selected, m=sceneMap(), ctx=context;
  mapTargets=[];
  const group=new Map(), step=state.scene==='castle'?20:(state.scale/state.baseline<1.6?34:23);
  const focus=new Map();
  for(const p of entrancePoints()) focus.set(p.id,p);
  if(selected && (state.scene!=='castle'||state.showAccess)) {
    for(const id of selected.entrances) {
      const ref=m.byId.get(id);
      if(!ref) continue;
      focus.set(ref.id,ref);
      const [x,y]=point(selected.x,selected.y),[u,v]=point(ref.x,ref.y);
      ctx.save();ctx.strokeStyle='#e9ceffa3';ctx.lineWidth=1.6;ctx.setLineDash([4,4]);
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(u,v);ctx.stroke();ctx.restore();
    }
  }
  if(selected) focus.set(selected.id,selected);
  for(const p of resultPoints) {
    if(focus.has(p.id)) continue;
    const [x,y]=point(p.x,p.y);
    if(x< -15 || x>state.w+15 || y< -15 || y>state.h+15) continue;
    const key=Math.floor(x/step)+','+Math.floor(y/step);
    const g=group.get(key);
    if(g) { g.points.push(p);g.x+=x;g.y+=y; }
    else group.set(key,{points:[p],x,y});
  }
  for(const g of group.values()) {
    const n=g.points.length,x=g.x/n,y=g.y/n,p=g.points[0];
    if(n===1) {
      drawGlyph(p.kind,x,y,8,false,p);
      mapTargets.push({x,y,r:16,p});
    } else {
      const r=n>12?13:11;
      ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);
      ctx.fillStyle='#1f455a';ctx.fill();
      ctx.lineWidth=1.25;ctx.strokeStyle=g.points.every(q=>q.kind===p.kind)?colors[p.kind]:'#e2e6df';ctx.stroke();
      ctx.fillStyle='#fff9e8';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='600 10px system-ui';
      ctx.fillText(String(n),x,y+.25);
      mapTargets.push({x,y,r:r+4,g:g.points});
    }
  }
  for (const p of focus.values()) {
    const [x,y]=point(p.x,p.y);
    drawGlyph(p.kind,x,y,p.id===selected?.id?11:10,p.id===selected?.id,p);
    mapTargets.push({x,y,r:16,p});
  }
}
function drawPortals() {
  const m=sceneMap(), layer=$('map-portals');
  layer.hidden=Boolean(state.floor);
  if(layer.hidden) return;
  // Resolve the label and action from the same destination. Source keys differ
  // from local scene IDs (e.g. sea-of-bygone-eras -> sea).
  if(layer.dataset.map!==String(m.id)) {
    layer.dataset.map=String(m.id);
    const buttons=[];
    for(const portal of m.portals) {
      const destination=Object.values(D.maps).find(map=>map.key===portal.targetMapKey);
      const scene=Object.keys(D.maps).find(key=>D.maps[key]===destination);
      if(!destination || !sceneNames[scene]) continue;
      const exit=portal.kind==='exit';
      const label=(exit?'返回':'前往')+sceneNames[scene];
      const b=document.createElement('button');
      b.type='button';b.className='map-portal';b.dataset.targetScene=scene;
      b.setAttribute('aria-label',label);
      b.innerHTML='<svg viewBox="0 0 32 32" aria-hidden="true"><path class="gate-arch" d="M6 26V13a10 10 0 0 1 20 0v13h2v3H4v-3Z"/><path class="gate-door" d="M11 26V14a5 5 0 0 1 10 0v12Z"/><path class="gate-arrow" d="'+(exit?'M16 23v-8m-3 3 3-3 3 3':'M16 15v8m-3-3 3 3 3-3')+'"/></svg><span>'+escapeHTML(label)+'</span>';
      b.portalPosition=portal.position;
      b.addEventListener('click',()=>{setScene(scene);canvas.focus({preventScroll:true});});
      buttons.push(b);
    }
    layer.replaceChildren(...buttons);
  }
  layer.classList.toggle('show-labels',state.scale/state.baseline>2);
  for(const b of layer.children) {
    const [x,y]=point(b.portalPosition.x,latY(b.portalPosition.y));
    b.hidden=x< -22 || x>state.w+22 || y< -22 || y>state.h+22;
    b.style.left=x+'px';b.style.top=y+'px';
  }
}
function draw() {
  frame=0;
  if(!state.scale || !state.w || !state.h) return;
  context.setTransform(state.dpr,0,0,state.dpr,0,0);
  context.fillStyle='#263e49';context.fillRect(0,0,state.w,state.h);
  const tiles=drawTiles(), overlay=drawFloor();
  drawResources();
  drawPortals();
  const zoom=Math.round(state.scale/state.baseline*100);
  $('map-scale').textContent=zoom+'%';
  Object.assign(canvas.dataset,{scene:state.scene,floor:state.floor||'',zoom,
    center:[state.cx,state.cy].map(v=>v.toFixed(7)).join(','),tiles,overlay});
}
function local(e) {
  const r=canvas.getBoundingClientRect();
  return {x:e.clientX-r.left,y:e.clientY-r.top};
}
function hit({x,y}) {
  for(let i=mapTargets.length-1;i>=0;i--) {
    const t=mapTargets[i];
    if(Math.hypot(x-t.x,y-t.y)<=t.r) return t;
  }
}
function activate(target) {
  if(!target) {state.selected=null;markSelected();return;}
  if(target.g) {
    if(state.scale<maxScale()*.96) {
      const [x,y]=centerWorld(target.x,target.y);
      state.cx=x;state.cy=y;zoomAt(1.75);
    } else selectPoint(target.g[0],false);
  } else if(target.p) {
    selectPoint(target.p,false,target.p.kind==='entrance');
  }
}

mapSurface.addEventListener('wheel',e=>{
  if(!e.target.closest('#map,.map-portal')) return;
  e.preventDefault();
  const {x,y}=local(e);
  const pixels=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?state.h:1);
  zoomAt(Math.exp(-clamp(pixels,-500,500)*.0022),x,y);
},{passive:false});
mapSurface.addEventListener('pointerdown',e=>{
  if(e.button!==0 || !e.target.closest('#map,.map-portal')) return;
  const portal=e.target.closest('.map-portal');
  if(portal) e.preventDefault();
  const p=local(e);
  if(!pointers.size) dragged=false;
  else dragged=true;
  pointers.set(e.pointerId,{...p,startX:p.x,startY:p.y,portal});
  canvas.setPointerCapture(e.pointerId);
});
mapSurface.addEventListener('pointermove',e=>{
  const p=local(e),prev=pointers.get(e.pointerId);
  if(!prev) {canvas.classList.toggle('hot',Boolean(hit(p)));return;}
  if(Math.hypot(p.x-prev.startX,p.y-prev.startY)>4) dragged=true;
  const other=[...pointers].find(([id])=>id!==e.pointerId)?.[1];
  if(dragged) {
    canvas.classList.add('dragging');
    if(other) {
      const old=Math.hypot(prev.x-other.x,prev.y-other.y),next=Math.hypot(p.x-other.x,p.y-other.y);
      if(old>4) {
        zoomAt(next/old,(prev.x+other.x)/2,(prev.y+other.y)/2);
        state.cx-=(p.x-prev.x)/state.scale/2;
        state.cy-=(p.y-prev.y)/state.scale/2;
      }
    } else {
      state.cx-=(p.x-prev.x)/state.scale;
      state.cy-=(p.y-prev.y)/state.scale;
    }
    constrain();schedule();
  }
  pointers.set(e.pointerId,{...prev,...p});
});
for(const type of ['pointerup','pointercancel','lostpointercapture']) {
  mapSurface.addEventListener(type,e=>{
    const pressed=pointers.get(e.pointerId);
    const was=pointers.delete(e.pointerId);
    if(pointers.size) return;
    canvas.classList.remove('dragging');
    if(was && type==='pointerup' && !dragged) {
      if(pressed.portal) pressed.portal.click();
      else activate(hit(local(e)));
    }
  });
}
canvas.addEventListener('keydown',e=>{
  const direction={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];
  if(direction) {
    state.cx+=direction[0]*52/state.scale;state.cy+=direction[1]*52/state.scale;
    constrain();schedule();
  } else if (e.key==='+' || e.key==='=') zoomAt(1.5);
  else if(e.key==='-') zoomAt(1/1.5);
  else if(e.key==='0') resetView();
  else return;
  e.preventDefault();
});
document.querySelector('.scenes').addEventListener('click',e=>{
  const region=e.target.closest('[data-region]');
  if(region) {setRegion(region.dataset.region);return;}
  const b=e.target.closest('[data-scene]');
  if(b) setScene(b.dataset.scene);
});
$('floors').addEventListener('click',e=>{
  const b=e.target.closest('[data-floor]');
  if(b && Number(b.dataset.floor)!==state.floor) {
    const floor=b.dataset.floor;
    setScene(state.scene,Number(floor));
    $('floors').querySelector('[data-floor="'+floor+'"]')?.focus();
  }
});
$('filters').addEventListener('click',e=>{
  const b=e.target.closest('[data-filter]');
  if(!b) return;
  state.filter=b.dataset.filter;state.type='';state.limit=120;state.selected=null;syncPanels();
});
$('access').addEventListener('change',e=>{state.showAccess=e.target.checked;schedule();});
window.addEventListener('online',()=>{
  for(const [key,tile] of hdTiles) if(tile.status==='error')hdTiles.delete(key);
  schedule();
});
$('search').addEventListener('input',e=>{state.query=e.target.value;state.limit=120;state.selected=null;syncPanels();});
$('search').addEventListener('keydown',e=>{if(e.key==='Enter')isPointQuery()?selectPoint(resultPoints[0]):fitResults();});
$('group-note').addEventListener('click',e=>{if(e.target.closest('#clear-type')) {state.type='';syncPanels();}});
$('results').addEventListener('click',e=>{
  if(e.target.closest('#more-results')) {
    const y=$('results').scrollTop;state.limit+=120;syncPanels();$('results').scrollTop=y;return;
  }
  const group=e.target.closest('[data-resource-type]');
  if(group) {
    state.type=state.type===group.dataset.resourceType?'':group.dataset.resourceType;
    state.selected=null;state.limit=120;syncPanels();if(state.type)fitResults();return;
  }
  const b=e.target.closest('[data-point]');
  if(b) selectPoint(sceneMap().byId.get(Number(b.dataset.point)));
});
$('detail').addEventListener('click',e=>{
  const ref=e.target.closest('[data-ref]');
  if(ref) selectPoint(sceneMap().byId.get(Number(ref.dataset.ref)),true,true);
  const f=e.target.closest('[data-see-floor]');
  if(f) {
    const p=state.selected;
    setScene(state.scene,Number(f.dataset.seeFloor));
    if(Number(f.dataset.seeFloor)) selectPoint(p,false);
  }
  if(e.target.closest('[data-close]')) {state.selected=null;markSelected();$('search').focus();}
});
$('plus').addEventListener('click',()=>zoomAt(1.5));
$('minus').addEventListener('click',()=>zoomAt(1/1.5));
$('reset').addEventListener('click',resetView);
$('map-select').addEventListener('change',e=>{if(e.target.value)setScene(e.target.value);});
$('type-select').addEventListener('change',e=>{state.type=e.target.value;state.limit=120;state.selected=null;syncPanels();});
$('region-tabs').innerHTML='<button type="button" data-scene="teyvat">提瓦特</button>'+D.maps.teyvat.areas.map(a=>'<button type="button" data-region="'+a.id+'">'+escapeHTML(areaNames[a.id]||a.id)+'</button>').join('');
$('region-select').innerHTML='<option value="">定位地区</option>'+D.maps.teyvat.areas.map(a=>'<option value="'+a.id+'">'+(areaNames[a.id]||a.id)+'</option>').join('');
$('region-select').addEventListener('change',e=>setRegion(e.target.value));
$('snapshot-date').textContent='数据 '+new Date(D.date).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'})+' · 本地预览';
$('snapshot-count').textContent=fmt.format(D.summary.records)+' 个源标点';
new ResizeObserver(syncSize).observe(canvas);
syncSize();
syncPanels();
