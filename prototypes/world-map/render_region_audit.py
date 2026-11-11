"""Render a self-contained Canvas evidence map for a region query."""
import argparse
import base64
import json
from pathlib import Path

from region_query import distance_to_ring, query


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--data', type=Path, required=True)
    cli.add_argument('--nearby', type=Path, required=True)
    cli.add_argument('--tiles', type=Path, required=True)
    cli.add_argument('--icon', type=Path, required=True)
    cli.add_argument('--output', type=Path, required=True)
    args = cli.parse_args()
    bundle = json.loads(args.data.read_text())
    result = query(bundle, '奥摩斯港', '草神瞳')
    area = next(a for a in bundle['areas'] if a['id'] == result['regionId'])
    matrix = bundle['models'][str(area['cityId'])]['matrix']
    def project(x, z):
        return [x * matrix[0][0] + z * matrix[1][0] + matrix[2][0],
                -(x * matrix[0][1] + z * matrix[1][1] + matrix[2][1])]
    points = []
    selected_ids = {p['id'] for p in result['points']}
    for match in json.loads(args.nearby.read_text()):
        p = next(p for p in bundle['points'] if p['id'] == match['appId'])
        x, _, z = match['position']
        distance = min(distance_to_ring([x, z], poly['ring']) for poly in area['polygons'])
        points.append({**p, 'inside': p['id'] in selected_ids, 'distance': distance,
                       'gameXYZ': match['position'], 'source': match['sourcePath']})
    data = {'result': result, 'polygons': [[project(*p) for p in poly['ring']] for poly in area['polygons']],
            'points': points, 'tiles': {}, 'icon': 'data:image/png;base64,' + base64.b64encode(args.icon.read_bytes()).decode()}
    for p in args.tiles.glob('*.jpg'):
        data['tiles'][p.stem] = 'data:image/jpeg;base64,' + base64.b64encode(p.read_bytes()).decode()
    html = TEMPLATE.replace('/* DATA */', json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c'))
    args.output.write_text(html)
    print(json.dumps({'output': str(args.output), 'count': result['count'], 'tiles': len(data['tiles'])}, ensure_ascii=False))


TEMPLATE = r'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>奥摩斯港 · 区域与神瞳核验</title><style>
:root{color-scheme:light;--ink:#183746;--muted:#687b80;--line:#d6d2c7;--paper:#f6f3eb;--green:#9ce4a6}*{box-sizing:border-box}body{margin:0;padding:28px;background:var(--paper);color:var(--ink);font:14px/1.6 system-ui,-apple-system,sans-serif}header{display:flex;justify-content:space-between;align-items:end;margin-bottom:20px;border-bottom:1px solid var(--line);padding-bottom:18px}.eyebrow{font-size:11px;letter-spacing:.18em;color:var(--muted)}h1{font:600 28px/1.4 "Songti SC",serif;margin:5px 0 0}header p{font-size:12px;color:var(--muted);margin:0}main{display:grid;grid-template-columns:minmax(0,1fr) 310px;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#fffdf8;height:calc(100vh - 150px);min-height:560px}.map{position:relative;background:#21404a;min-width:0}canvas{display:block;width:100%;height:100%;touch-action:none;cursor:grab}.legend{position:absolute;left:20px;top:20px;padding:12px 16px;background:#173540e8;border:1px solid #ffffff33;border-radius:7px;color:#edf0df;font-size:12px}.legend b{color:#a9e6a7}.hint{position:absolute;left:20px;bottom:17px;background:#173540df;color:#e4eceb;padding:5px 10px;border-radius:4px;font-size:11px}.zoom{position:absolute;right:18px;bottom:18px;display:grid;gap:1px}.zoom button{border:1px solid #ffffff44;background:#173540eb;color:white;font-size:20px;width:40px;height:38px;cursor:pointer}.zoom button:last-child{font-size:13px}aside{padding:24px;overflow:auto;border-left:1px solid var(--line)}h2{font:600 20px "Songti SC",serif;margin:0 0 15px}.total{font:500 60px/1.1 Georgia,serif;margin:12px 0}.total small{font:14px system-ui;color:var(--muted)}.note{font-size:12px;color:var(--muted);line-height:1.8}hr{border:0;border-top:1px solid var(--line);margin:22px 0}.point{display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid #e8e4da;color:var(--ink);text-decoration:none}.point img{width:30px;height:36px;object-fit:contain}.point span{flex:1}.point small{display:block;color:var(--muted);font-size:11px}a{color:#2c5867}.proof{font-size:12px;line-height:1.9}.proof dt{color:var(--muted)}.proof dd{margin:0 0 10px}.pill{display:inline-block;font-size:11px;padding:2px 8px;border-radius:3px;background:#e5efdf;color:#326347}.error{color:#8b3c30}@media(max-width:760px){body{padding:14px}header{align-items:start;gap:12px}h1{font-size:22px}header p{max-width:100px}main{grid-template-columns:1fr;height:auto;min-height:0}.map{height:65vh;min-height:420px}aside{border-left:0;border-top:1px solid var(--line)}.legend{left:12px;top:12px}}
</style><header><div><div class="eyebrow">提瓦特资源图志 ／ 区域核验</div><h1>奥摩斯港有多少草神瞳？</h1></div><p>固定点库 · 7.2<br>游戏边界 × 三维坐标对照</p></header>
<main><section class="map"><canvas id="map" aria-label="奥摩斯港围栏与草神瞳，可拖动缩放"></canvas><div class="legend"><b>绿色区域</b>　奥摩斯港本体<br>实色标点计入 · 灰色标点在界外</div><div class="hint">拖动平移 · 滚轮缩放 · 点击标点查看来源</div><div class="zoom"><button id="in" aria-label="放大">+</button><button id="out" aria-label="缩小">−</button><button id="reset">复位</button></div></section><aside><div class="eyebrow">须弥 / 阿陀河谷</div><h2>奥摩斯港</h2><div class="total"><span id="count"></span> <small>个草神瞳</small></div><span class="pill" id="status"></span><p class="note">以游戏中该小区域的实际多边形为范围。港区周边山地中的标点单独展示，不并入港区数量。</p><div id="points"></div><hr><dl class="proof"><dt>区域边界</dt><dd id="geometry"></dd><dt>坐标核验</dt><dd id="calibration"></dd><dt>边缘点复核</dt><dd>以公开三维采集坐标复核包含关系和高度；保留源记录与点位编号。</dd></dl><p class="note">这是固定数据的核验页。资源采集坐标为社区记录，未声称等同客户端物件的原生坐标。</p></aside></main>
<script>const D=/* DATA */;
const el=id=>document.getElementById(id),canvas=el('map'),ctx=canvas.getContext('2d');let w=0,h=0,dpr=1,cx=0,cy=0,scale=1,base=1,drag=null,hit=[];
const tiles=new Map(),icon=new Image();icon.src=D.icon;icon.onload=draw;let loaded=0;
for(const [key,url]of Object.entries(D.tiles)){const im=new Image();im.onload=()=>{loaded++;draw()};im.src=url;tiles.set(key,im)}
const pts=D.points.map(p=>({...p,x:p.lng,y:-Math.asinh(Math.tan(p.lat*Math.PI/180))*180/Math.PI}));
el('count').textContent=D.result.count;el('status').textContent=D.result.status==='crosschecked'?'区域与三维坐标已对照':'存在需复核的点位';
el('geometry').textContent='区域 #'+D.result.regionId+' · '+D.polygons.reduce((n,p)=>n+p.length,0)+' 个边界顶点';
el('calibration').textContent=D.result.calibration.training.count+' 个拟合锚点 + '+D.result.calibration.holdout.count+' 个独立验证点。验证最大偏差 '+D.result.calibration.holdout.max.toFixed(2)+' 个游戏坐标单位。';
el('points').innerHTML=D.result.points.map(p=>'<a class="point" target="_blank" rel="noopener" href="'+p.url+'"><img alt="草神瞳" src="'+D.icon+'"><span>草神瞳 #'+p.id+'<small>区域内 · 查看原始标点</small></span>↗</a>').join('');
const screen=(x,y)=>[(x-cx)*scale+w/2,(y-cy)*scale+h/2];
function fit(){const v=[...D.polygons.flat(),...pts.map(p=>[p.x,p.y])],xs=v.map(p=>p[0]),ys=v.map(p=>p[1]);cx=(Math.min(...xs)+Math.max(...xs))/2;cy=(Math.min(...ys)+Math.max(...ys))/2;scale=Math.min((w-100)/(Math.max(...xs)-Math.min(...xs)),(h-140)/(Math.max(...ys)-Math.min(...ys)));base=scale;draw()}
function resize(){const b=canvas.getBoundingClientRect();w=b.width;h=b.height;dpr=Math.min(devicePixelRatio||1,2);canvas.width=w*dpr;canvas.height=h*dpr;fit()}
function draw(){if(!w)return;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#21404a';ctx.fillRect(0,0,w,h);const step=360/2**15;
for(const [key,im]of tiles){if(!im.complete||!im.naturalWidth)continue;const [x,y]=key.split('_').map(Number),[sx,sy]=screen(x*step,(-y-1)*step),s=step*scale;ctx.drawImage(im,sx,sy,s+.5,s+.5)}
for(const ring of D.polygons){ctx.beginPath();ring.forEach(([x,y],i)=>{const p=screen(x,y);i?ctx.lineTo(...p):ctx.moveTo(...p)});ctx.closePath();ctx.fillStyle='#86d58a32';ctx.fill();ctx.lineWidth=3;ctx.strokeStyle='#c2f6a5';ctx.stroke()}
hit=[];for(const p of pts){const [x,y]=screen(p.x,p.y);ctx.save();ctx.globalAlpha=p.inside?1:.55;ctx.beginPath();ctx.arc(x,y,20,0,Math.PI*2);ctx.fillStyle=p.inside?'#153a31dd':'#243c42dd';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle=p.inside?'#c7f4a9':'#d3d7d6';ctx.stroke();if(icon.complete&&icon.naturalWidth)ctx.drawImage(icon,x-14,y-18,28,34);ctx.restore();ctx.font='600 11px system-ui';const text='#'+p.id+(p.inside?' · 计入':' · 界外'),tw=ctx.measureText(text).width;ctx.fillStyle='#15323dea';ctx.fillRect(x-tw/2-6,y+24,tw+12,22);ctx.fillStyle=p.inside?'#e9f6df':'#e0e3e3';ctx.fillText(text,x-tw/2,y+39);hit.push({x,y,p})}
canvas.dataset.tiles=loaded;canvas.dataset.count=D.result.count;canvas.dataset.zoom=String(scale/base);}
function zoom(f,x=w/2,y=h/2){const wx=(x-w/2)/scale+cx,wy=(y-h/2)/scale+cy;scale=Math.max(base*.65,Math.min(base*3,scale*f));cx=wx-(x-w/2)/scale;cy=wy-(y-h/2)/scale;draw()}
canvas.addEventListener('wheel',e=>{e.preventDefault();const b=canvas.getBoundingClientRect();zoom(Math.exp(-e.deltaY*.0015),e.clientX-b.left,e.clientY-b.top)},{passive:false});
canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY,cx,cy,moved:false};canvas.style.cursor='grabbing'});
canvas.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)>4)drag.moved=true;cx=drag.cx-dx/scale;cy=drag.cy-dy/scale;draw()});
canvas.addEventListener('pointerup',e=>{if(drag&&!drag.moved){const b=canvas.getBoundingClientRect();const t=hit.find(t=>Math.hypot(t.x-(e.clientX-b.left),t.y-(e.clientY-b.top))<24);if(t)window.open('https://genshin-impact-map.appsample.com/?id='+t.p.id+'&mid=2&type=o403','_blank','noopener')}drag=null;canvas.style.cursor='grab'});canvas.addEventListener('pointercancel',()=>drag=null);
el('in').onclick=()=>zoom(1.25);el('out').onclick=()=>zoom(.8);el('reset').onclick=fit;new ResizeObserver(resize).observe(canvas);
</script></html>'''


if __name__ == '__main__':
    main()
