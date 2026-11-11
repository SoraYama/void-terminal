"""Check packed marker projection against actual source tile pixels."""
import base64
from collections import Counter
from functools import lru_cache
from io import BytesIO
import json
import math
from pathlib import Path
import sys
from PIL import Image

p=Path(sys.argv[1])
data=json.loads(p.read_text().split('<script id="atlas-data" type="application/json">')[1].split('</script>',1)[0])

@lru_cache(maxsize=1500)
def tile(scene,z,key):
    uri=data['maps'][scene]['tiles'][str(z)].get(key)
    return Image.open(BytesIO(base64.b64decode(uri.split(',')[1]))).convert('RGB') if uri else None

results={}
for scene,m in data['maps'].items():
    counts=Counter()
    for pid,t,lng,lat,floor,*_ in m['points']:
        if data['types'][str(t)][2]!='oculus': continue
        z=12
        u=lng*2**z/360
        v=-math.degrees(math.asinh(math.tan(math.radians(lat))))*2**z/360
        x,y=math.floor(u),math.floor(v)
        image=tile(scene,z,f'{x},{y}')
        if image is None: counts['missing']+=1; continue
        pixel=image.getpixel((int((u-x)*256),int((v-y)*256)))
        if max(pixel)>20:
            counts['mapped']+=1
        elif str(floor) in m['floors']:
            f=m['floors'][str(floor)]; b=f['bounds']
            layer=Image.open(BytesIO(base64.b64decode(f['image'].split(',')[1]))).convert('RGBA')
            xx=(lng-b['west'])/(b['east']-b['west'])
            yy=(b['north']-lat)/(b['north']-b['south'])
            if 0<=xx<1 and 0<=yy<1:
                rgba=layer.getpixel((int(xx*layer.width),int(yy*layer.height)))
                counts['mapped_in_floor' if rgba[3]>20 and max(rgba[:3])>20 else 'unresolved_black']+=1
            else: counts['outside_floor']+=1
        else:
            counts['unresolved_black']+=1
            print('source has no supporting layer',scene,pid)
    results[scene]=dict(counts)
    assert not counts['missing'],(scene,counts)
    assert not counts['unresolved_black'] and not counts['outside_floor'],(scene,counts)
print(json.dumps(results,ensure_ascii=False,indent=2))
p.with_name('geometry-7.2.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
