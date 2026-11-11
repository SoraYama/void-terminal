"""Audit calibration only; rejects ambiguous and unmatched anchors. Requires numpy."""
import json,numpy as np,math
from pathlib import Path
from itertools import accumulate
import argparse
cli=argparse.ArgumentParser(description='Fit game-to-AppSample coordinates with disjoint anchor holdouts')
cli.add_argument('--point-config',type=Path,required=True)
cli.add_argument('--markers',type=Path,required=True)
cli.add_argument('--cities',type=Path,required=True)
cli.add_argument('--output',type=Path,required=True)
args=cli.parse_args()
def read(p):return json.loads(Path(p).read_text())
game=read(args.point_config)['points'];raw=read(args.markers)['data'];app=[dict(zip(['id','type','mid','lng','lat','meta'],r)) for r in zip(accumulate(raw['id']),raw['type'],raw['mid'],raw['lng'],raw['lat'],raw['meta'])]
app=[p for p in app if p['mid']==2]
def xy(p):return [p['lng'],math.degrees(math.asinh(math.tan(math.radians(p['lat']))))]
scale=.0000859
cities=read(args.cities);results={}
for city in cities:
 cid=city['cityId']
 if cid not in range(1,8):continue
 areas=city.get('areaIdVec',[]);gg=[{'id':int(k),'kind':'o2' if v.get('type')=='TOWER' else 'o3','x':v['pos'].get('x',0),'z':v['pos'].get('z',0),'area':v['areaId']} for k,v in game.items() if v.get('$type')=='SceneTransPoint' and v['areaId'] in areas and v.get('type') in [None,'TOWER'] and v.get('mapVisibility')!='Never']
 aa={kind:[p for p in app if p['type']==kind] for kind in ['o2','o3']};aco={k:np.array([xy(p) for p in pp]) for k,pp in aa.items()}
 M=np.array([[0,scale],[-scale,0],[.45853-(.189 if cid==3 else 0),-.00098]])
 def pairs(M,validation=False):
  matches=[]
  for g in gg:
   if (g['id']%3==0)!=validation:continue
   pred=np.array([g['x'],g['z'],1])@M;dist=np.linalg.norm(aco[g['kind']]-pred,axis=1)/scale;order=np.argsort(dist);j=order[0]
   if dist[j]>30 or dist[order[1]]-dist[j]<25:continue
   matches.append((g,aa[g['kind']][j],float(dist[j])))
  # Unique target on each side; reject collisions rather than select first
  from collections import Counter
  counts=Counter(a['id'] for _,a,_ in matches)
  return [m for m in matches if counts[m[1]['id']]==1]
 for iteration in range(6):
  train=pairs(M)
  if len(train)<6:break
  X=np.array([[g['x'],g['z'],1] for g,a,d in train]);Y=np.array([xy(a) for g,a,d in train]);M=np.linalg.lstsq(X,Y,rcond=None)[0]
  residual=np.linalg.norm(X@M-Y,axis=1)/scale;keep=residual<max(8,np.median(residual)*3)
  if sum(keep)>=6:M=np.linalg.lstsq(X[keep],Y[keep],rcond=None)[0]
 test=pairs(M,True);train=pairs(M)
 def records(pp):return [{'gameId':g['id'],'appId':a['id'],'type':g['kind'],'areaId':g['area'],'distanceWorld':d,'gameXZ':[g['x'],g['z']],'appXY':xy(a)} for g,a,d in pp]
 def stats(pp):
  ds=[m[2] for m in pp];return {'count':len(ds),'median':float(np.median(ds)) if ds else None,'p95':float(np.percentile(ds,95)) if ds else None,'max':max(ds) if ds else None}
 results[str(cid)]={'matrix':M.tolist(),'training':records(train),'holdout':records(test),'trainingStats':stats(train),'holdoutStats':stats(test),'candidates':len(gg),'areaIds':areas,'unmatchedIds':[g['id'] for g in gg if g['id'] not in {r[0]['id'] for r in train+test}], 'holdoutRule':'gamePointId % 3 == 0; excluded from fitting', 'units':'Game-world units inferred from 0.0000859 map units per game unit; empirical residuals, not an error bound'}
 print(cid,len(gg),stats(train),stats(test))
args.output.write_text(json.dumps(results,ensure_ascii=False,indent=2))
