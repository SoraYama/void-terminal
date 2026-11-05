"""Bounded, provider-constrained image checks. No browser input is accepted here."""
from __future__ import annotations
import concurrent.futures
import copy
import json
import re
import socket
import struct
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

MAX_HEADER=65536
ALLOWED={
    'upload-os-bbs.mihoyo.com':{'/game_record/genshin/equip/':('UI_',)},
    'gi.yatta.moe':{'/assets/UI/':('UI_','Skill_'),
        '/assets/UI/furniture/':('UI_Homeworld_',),
        '/assets/UI/reliquary/':('UI_RelicIcon_',),
        '/assets/UI/namecard/':('UI_NameCardIcon_','UI_NameCardPic_'),
        '/assets/UI/gcg/':('UI_Gcg_CardFace_',),
        '/assets/UI/monster/':('UI_AnimalIcon_',)},
}
AUDIT_FIELDS={'status','checkedAt','contentType','width','height','temporary','reason'}


def allowed_url(url):
    try:
        parsed=urllib.parse.urlsplit(url)
        filename=parsed.path.rsplit('/',1)[-1]
        return (parsed.scheme=='https' and parsed.hostname in ALLOWED and parsed.port in (None,443)
            and not parsed.username and not parsed.password and not parsed.query and not parsed.fragment
            and bool(re.fullmatch(r'(?:UI|Skill)_[A-Za-z0-9_]+\.(?:png|webp|jpg|jpeg)',filename))
            and any(parsed.path==prefix+filename and filename.startswith(families)
                    for prefix,families in ALLOWED[parsed.hostname].items()))
    except (TypeError,ValueError):return False


def image_provider(url):
    return 'mihoyo' if urllib.parse.urlsplit(url).hostname=='upload-os-bbs.mihoyo.com' else 'yatta'


def image_candidates(icon):
    """Fixed observed provider patterns, constructed solely from source icon IDs."""
    identifier=icon.get('identifier')
    if identifier is None:
        # Compatibility for legacy offline records without an identifier field;
        # this does not introduce a request-time or browser URL interface.
        return (icon['url'],) if allowed_url(icon.get('url')) else ()
    if not isinstance(identifier,str) or not re.fullmatch(r'(?:UI|Skill)_[A-Za-z0-9_]+',identifier):return ()
    plain=f'https://gi.yatta.moe/assets/UI/{identifier}.png'
    official=f'https://upload-os-bbs.mihoyo.com/game_record/genshin/equip/{identifier}.png'
    if identifier.startswith('UI_Homeworld_'):
        return (f'https://gi.yatta.moe/assets/UI/furniture/{identifier}.png',)
    if identifier.startswith('UI_RelicIcon_'):
        return (official,f'https://gi.yatta.moe/assets/UI/reliquary/{identifier}.png')
    if identifier.startswith('UI_EquipIcon_'):return (official,plain)
    if identifier.startswith(('UI_NameCardIcon_','UI_NameCardPic_')):
        return (plain,f'https://gi.yatta.moe/assets/UI/namecard/{identifier}.png')
    if identifier.startswith('UI_AnimalIcon_'):
        return (plain,f'https://gi.yatta.moe/assets/UI/monster/{identifier}.png')
    if identifier.startswith('UI_Gcg_CardFace_'):
        return (plain,f'https://gi.yatta.moe/assets/UI/gcg/{identifier}.png')
    return (plain,)


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        if not allowed_url(newurl):raise ValueError('Image redirect outside allowed providers')
        return super().redirect_request(req,fp,code,msg,headers,newurl)


def _open(request,timeout):
    return urllib.request.build_opener(SafeRedirect()).open(request,timeout=timeout)


def dimensions(data):
    if data.startswith(b'\x89PNG\r\n\x1a\n') and len(data)>=26 and data[12:16]==b'IHDR':
        return 'image/png',*struct.unpack('>II',data[16:24])
    if data[:4]==b'RIFF' and data[8:12]==b'WEBP' and len(data)>=30:
        if data[12:16]==b'VP8X':return 'image/webp',1+int.from_bytes(data[24:27],'little'),1+int.from_bytes(data[27:30],'little')
        if data[12:16]==b'VP8L' and data[20]==0x2f:
            bits=int.from_bytes(data[21:25],'little');return 'image/webp',(bits&0x3fff)+1,((bits>>14)&0x3fff)+1
        if data[12:16]==b'VP8 ' and data[23:26]==b'\x9d\x01\x2a':
            return 'image/webp',int.from_bytes(data[26:28],'little')&0x3fff,int.from_bytes(data[28:30],'little')&0x3fff
    if data[:2]==b'\xff\xd8':
        i=2
        while i+4<=len(data):
            if data[i]!=255:break
            marker=data[i+1];i+=2
            if marker==255:i-=1;continue
            if marker in (0xd8,0xd9) or 0xd0<=marker<=0xd7:continue
            size=int.from_bytes(data[i:i+2],'big')
            if size<2 or i+size>len(data):break
            if marker in {0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf} and size>=7:
                return 'image/jpeg',int.from_bytes(data[i+5:i+7],'big'),int.from_bytes(data[i+3:i+5],'big')
            i+=size
    raise ValueError('Image header has no supported dimensions')


def check_image(url):
    if not allowed_url(url):return {'status':'missing','reason':'provider-or-identifier-not-allowed','temporary':False}
    headers={'User-Agent':'void-terminal-image-audit/1','Accept':'image/png,image/webp,image/jpeg'}
    try:
        try:
            with _open(urllib.request.Request(url,headers=headers,method='HEAD'),timeout=15) as response:
                if response.status!=200:raise ValueError('Unexpected HEAD response')
        except urllib.error.HTTPError as exc:
            if exc.code not in (403,405,501):raise
        with _open(urllib.request.Request(url,headers={**headers,'Range':f'bytes=0-{MAX_HEADER-1}'}),timeout=20) as response:
            if response.status not in (200,206):raise ValueError('Unexpected GET response')
            content_type=response.headers.get('Content-Type','').split(';',1)[0].lower()
            data=response.read(MAX_HEADER)
        detected,width,height=dimensions(data)
        if content_type!=detected or not (1<=width<=16384 and 1<=height<=16384):raise ValueError('Invalid image type or dimensions')
        return {'status':'verified','contentType':detected,'width':width,'height':height,'temporary':False}
    except urllib.error.HTTPError as exc:
        return {'status':'unreachable','reason':f'http-{exc.code}','temporary':exc.code in (408,425,429) or exc.code>=500}
    except (urllib.error.URLError,TimeoutError,socket.timeout,OSError) as exc:
        return {'status':'unreachable','reason':type(exc).__name__,'temporary':True}
    except ValueError as exc:
        return {'status':'unreachable','reason':str(exc),'temporary':False}


def verify_images(items: list[dict], cache_path: Path, workers: int = 12) -> list[dict]:
    if not 1<=workers<=64:raise ValueError('Image workers must be between 1 and 64')
    cache_path=Path(cache_path)
    try:
        saved=json.loads(cache_path.read_text());cache=saved.get('checks',{}) if saved.get('version')==1 else {}
    except (OSError,ValueError,AttributeError):cache={}
    now=time.time()
    chains=[image_candidates(i.get('icon',{})) for i in items]
    choices={chain:0 for chain in chains if chain}
    active=set(choices)
    def check(url):return url,{**check_image(url),'checkedAt':now}
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        while active:
            pending=[]
            for url in sorted({chain[choices[chain]] for chain in active}):
                old=cache.get(url,{})
                ttl=300 if old.get('temporary') else 30*86400 if old.get('status')=='verified' else 86400
                if not old or now-old.get('checkedAt',0)>ttl:pending.append(url)
            for url,result in pool.map(check,pending):cache[url]=result
            following=set()
            for chain in active:
                result=cache[chain[choices[chain]]]
                # A transient failure is not evidence that the resource moved.
                # Only an observed cached/live 404 permits another fixed path.
                if result.get('reason')=='http-404' and choices[chain]+1<len(chain):
                    choices[chain]+=1;following.add(chain)
            active=following
    cache_path.parent.mkdir(parents=True,exist_ok=True)
    temporary=cache_path.with_name(cache_path.name+'.partial')
    temporary.write_text(json.dumps({'version':1,'checks':cache},sort_keys=True));temporary.replace(cache_path)
    result=copy.deepcopy(items)
    for item,chain in zip(result,chains):
        icon=item.setdefault('icon',{})
        for field in AUDIT_FIELDS:icon.pop(field,None)
        if chain:
            url=chain[choices[chain]]
            icon.update(url=url,provider=image_provider(url),**cache[url])
        else:
            icon.update(url=None,provider=None,status='missing',reason='provider-or-identifier-not-allowed',temporary=False)
        status=icon['status']
        item.setdefault('coverage',{})['image']='complete' if status=='verified' else 'unreachable' if status=='unreachable' else 'upstream-missing'
    return result
