"""Build a local, offline AppSample map; pin input files and audit every record."""
import argparse
import base64
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from io import BytesIO
from itertools import accumulate
import json
import math
from pathlib import Path
import re
import subprocess
from PIL import Image

HERE = Path(__file__).resolve().parent
SCENES = {'teyvat':2,'enkanomiya':7,'chasm':9,'sea':34,'sacred':36,'space':37,'moon':40}

def flight(path):
    pattern = r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)'
    return ''.join(json.loads(m.group(1)) for m in re.finditer(pattern,path.read_text()))

def field(text,key):
    return json.JSONDecoder().raw_decode(text.split('"'+key+'":',1)[1])[0]

def lat_y(lat):
    return -math.degrees(math.asinh(math.tan(math.radians(lat))))

def main():
    cli=argparse.ArgumentParser()
    cli.add_argument('--source',type=Path,required=True)
    cli.add_argument('--output',type=Path,required=True)
    cli.add_argument('--cache',type=Path,required=True)
    cli.add_argument('--fetch',action='store_true')
    cli.add_argument('--online-hd',action='store_true',help='Use the -hd preview filename (native tiles are enabled by default)')
    cli.add_argument('--offline',action='store_true',help='Disable runtime native-tile requests in the generated file')
    args=cli.parse_args()
    args.output.mkdir(exist_ok=True,parents=True)
    args.cache.mkdir(exist_ok=True,parents=True)
    main_flight=flight(args.source/'teyvat.html')
    zh=field(flight(args.source/'zh.html'),'messages')
    en=field(main_flight,'messages')
    definitions={m['id']:m for m in field(main_flight,'maps')}
    categories={}
    for scene,mid in SCENES.items():
        m=next(m for m in field(flight(args.source/f'{scene}.html'),'maps') if m['id']==mid)
        definitions[mid]=m
        for c in m.get('categories',[]):
            for t in c.get('types',[]): categories.setdefault(t,set()).add(c['id'])
    raw=(args.source/'markers.json').read_bytes()
    source=json.loads(raw)
    d=source['data']
    assert source['encoding']['delta']==['id']
    assert len({len(v) for v in d.values()})==1
    all_points={}
    types={}
    for row in zip(accumulate(d['id']),d['type'],d['mid'],d['lng'],d['lat'],d['meta']):
        i,t,m,x,y,meta=row
        assert m in SCENES.values() and (m,i) not in all_points
        assert all(math.isfinite(v) for v in (x,y))
        assert t.startswith('o') and t[1:].isdigit()
        n=zh['markers'].get(t,'未命名资源 '+t)
        cat=categories.get(t,set())
        if t in {'o5','o6','o194','o403','o508','o626','o694','o833'}: kind='oculus'
        elif cat & {'local'}: kind='material'
        elif t in {'o17','o44','o45','o46','o269'}: kind='chest'
        elif t=='o127' or '藏物箱' in n or t in {'o129','o359','o366'}: kind='mora'
        elif t in {'o2','o3','o410','o488','o489','o490','o521'}: kind='entrance'
        elif 'hiddenchest' in cat: kind='puzzle'
        elif 'monster' in cat: kind='enemy'
        else: kind='other'
        types[int(t[1:])]=[n,en['markers'].get(t,t),kind]
        layer=next((v[2:] for v in meta.split(';') if v.startswith('l=')),None)
        entries,group,floor=layer.split('|') if layer else ('','','')
        all_points[m,i]=[i,int(t[1:]),x,y,int(floor or 0),[int(e) for e in entries.split('_') if e],int(group or 0)]
    data={'types':types,'maps':{},'date':source['time'],'version':'7.2','icons':{},'summary':{},'onlineHD':not args.offline}
    report={'sourceTime':source['time'],'sha256':sha256(raw).hexdigest(),'records':len(all_points),'scenes':{},'unknownNames':[],'missingAssets':[]}
    jobs={}
    def add(name,url):
        jobs[name]=url
        return name
    for scene,mid in SCENES.items():
        cfg=definitions[mid]
        rows=[p for (m,_),p in all_points.items() if m==mid]
        b=cfg['maxBounds']
        west=min(p[2] for p in rows)-.04; east=max(p[2] for p in rows)+.04
        south=min(p[3] for p in rows)-.04; north=max(p[3] for p in rows)+.04
        # Keep snapshot's entire coordinate extent, including newer map regions.
        bounds=[max(b['west'],west),max(b['south'],south),min(b['east'],east),min(b['north'],north)]
        tiles={}; tile_cfg=cfg['tiles']
        for z in range(10,13):
            tiles[z]={}
            u=2**z/360
            lim=tile_cfg.get('tileBounds',{})
            lim=lim.get(str(z),{}) if isinstance(lim,dict) else {}
            for x in range(max(lim.get('minX',-999),math.floor(bounds[0]*u)),min(lim.get('maxX',999),math.floor(bounds[2]*u))+1):
                for y in range(max(lim.get('minY',-999),math.floor(-lat_y(bounds[1])*u)),min(lim.get('maxY',999),math.floor(-lat_y(bounds[3])*u))+1):
                    name=add(f'{scene}_{z}_{x}_{y}.jpg',tile_cfg['urlTemplate'].format(x=x,y=y,z=z))
                    tiles[z][f'{x},{-y-1}']=name
        # Retain close-up detail for the original Fontaine prototype and the latest
        # Cryoculus area. Other regions retain the complete 10-12 offline pyramid.
        details=[]
        if scene=='teyvat':
            details += [(z,[-.022,.068,.254,.475]) for z in (13,14)]
            cryo=[p for p in rows if p[1]==833]
            if cryo:
                details.append((13,[min(p[2] for p in cryo)-.02,min(p[3] for p in cryo)-.02,max(p[2] for p in cryo)+.02,max(p[3] for p in cryo)+.02]))
        if scene=='sea': details.append((13,bounds))
        for z,detail_bounds in details:
            tiles.setdefault(z,{})
            u=2**z/360
            for x in range(math.floor(detail_bounds[0]*u),math.floor(detail_bounds[2]*u)+1):
                for y in range(math.floor(-lat_y(detail_bounds[1])*u),math.floor(-lat_y(detail_bounds[3])*u)+1):
                    name=add(f'{scene}_{z}_{x}_{y}.jpg',tile_cfg['urlTemplate'].format(x=x,y=y,z=z))
                    tiles[z][f'{x},{-y-1}']=name
        floors={}
        for f in cfg.get('overlays',[]):
            floors[f['id']]={**{k:f[k] for k in ('id','groupId','name','bounds')},
                'image':add(f'floor_{mid}_{f["id"]}.png',f['url'])}
        portals=cfg.get('entrances',[])
        data['maps'][scene]={'id':mid,'key':cfg['key'],'name':zh['maps'].get(cfg['key'],scene),'tiles':tiles,
            'nativeTiles':{k:tile_cfg[k] for k in ('urlTemplate','minZoom','maxZoom','tileSize','tileBounds') if k in tile_cfg},
            'bounds':bounds,'initial':bounds,'floors':floors,'points':rows,'portals':portals,'areas':cfg.get('areas',[])}
        missing_refs=[(p[0],ref) for p in rows for ref in p[5] if (mid,ref) not in all_points]
        missing_floors=[p[0] for p in rows if p[4] and p[4] not in floors]
        report['scenes'][scene]={'id':mid,'points':len(rows),'classes':dict(Counter(types[p[1]][2] for p in rows)),
            'oculi':dict(Counter(types[p[1]][0] for p in rows if types[p[1]][2]=='oculus')),
            'floors':len(floors),'missingFloors':missing_floors,'missingEntrances':missing_refs,
            'tileVersion':tile_cfg['urlTemplate']}
    for t in types:
        data['icons'][t]=add(f'icon_{t}.png',f'https://game-cdn.appsample.com/gim/markers/o{t}.png?v=3')
        if types[t][0].startswith('未命名'): report['unknownNames'].append([t,sum(p[1]==t for p in all_points.values())])

    def fetch(pair):
        name,url=pair; p=args.cache/name
        if not p.exists() and args.fetch:
            subprocess.run(['curl','-fLsS','--max-time','18','--retry','1','-o',str(p),url],capture_output=True)
        if not p.exists(): return name,None
        try:
            blob=p.read_bytes(); im=Image.open(BytesIO(blob)); im.verify()
        except Exception:
            p.unlink(missing_ok=True); return name,None
        return name,blob
    assets={}
    with ThreadPoolExecutor(8) as pool:
        for count,(name,blob) in enumerate(pool.map(fetch,jobs.items()),1):
            if blob:
                mime='image/jpeg' if name.endswith('.jpg') else 'image/png'
                assets[name]='data:'+mime+';base64,'+base64.b64encode(blob).decode()
            else: report['missingAssets'].append(name)
            if count%250==0: print('assets',count,'/',len(jobs),flush=True)
    for m in data['maps'].values():
        for z,items in m['tiles'].items():
            m['tiles'][z]={k:assets[n] for k,n in items.items() if n in assets}
        for f in m['floors'].values(): f['image']=assets.get(f['image'],'')
    data['icons']={t:assets.get(n,'') for t,n in data['icons'].items()}
    for t in (508,500,548,503,44,127):
        svg=HERE/'icons'/f'{t}.svg'
        if svg.exists(): data['icons'][t]='data:image/svg+xml;base64,'+base64.b64encode(svg.read_bytes()).decode()
    report['loadedAssets']=len(assets)
    report['types']=len(types)
    data['summary']=report
    # Preserve Fontaine as an explicit local view, rather than cloning the main dataset.
    data['fontaineIds']=[]
    for p in data['maps']['teyvat']['points']:
        u=(p[2]-.33314565158651044)/.00008581802238050456
        v=(p[3]-.19941397307989506)/-.00008584331336280794
        x=.9994758420*u-.00000447733*v-2207.5591714
        y=.00000696994*u+.9997689516*v+.5243709
        if -6052<=x<=-3411.5 and -2900.25<=y<=1245.5 or p[6]==129: data['fontaineIds'].append(p[0])
    html=(HERE/'index.template.html').read_text().replace('<!-- MAP_ICON -->',(HERE/'icons/map.svg').read_text()).replace('/* CSS */',(HERE/'atlas.css').read_text()).replace('/* JS */',(HERE/'atlas.js').read_text()).replace('/* DATA */',json.dumps(data,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c'))
    (args.output/('teyvat-atlas-7.2-hd.html' if args.online_hd else 'teyvat-atlas-7.2.html')).write_text(html)
    (args.output/'audit-7.2.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps({k:v for k,v in report.items() if k!='scenes'},ensure_ascii=False),flush=True)

if __name__=='__main__': main()
