'use client';

import {memo, useEffect, useId, useRef, useState} from 'react';
import {ArrowClockwise, ArrowSquareOut, CaretLeft, CaretRight, Crosshair, MapTrifold, Minus, Plus} from '@phosphor-icons/react';
import type {Locale} from '../lib/contracts';
import {MAX_MAP_CARDS, mapIconUrl, mapMarkerUrl, mapTileUrl, type MapCard, type MapMarker} from '../lib/map-cards';
import {clusterMapMarkers, drawMapBoundary, fitMapViewport, mapTileLoadState, mapToScreen, visibleMapTiles, zoomMapViewport,
  type MapCluster, type MapLoadState, type MapPosition, type MapTile, type MapViewport} from '../lib/map-viewport';
import './resource-map-card.css';

type MapControls = {zoom: (factor: number) => void; reset: () => void; select: (id: number) => void; retry: () => void};
type MapImage = ImageBitmap | HTMLImageElement;
type TileEntry = {tile: MapTile; state: 'queued' | 'loading' | 'ready' | 'error'; image?: MapImage; controller?: AbortController; used: number};
const PAGE_SIZE = 10;
const TILE_CACHE_SIZE = 128;
const tileKey = (tile: MapTile) => `${tile.z}/${tile.x}/${tile.sourceY}`;
const disposeImage = (image?: MapImage) => {if (image && 'close' in image) image.close();};

async function loadMapImage(url: string, signal: AbortSignal): Promise<MapImage> {
  const response = await fetch(url, {signal, credentials: 'same-origin'});
  if (!response.ok) throw new Error('Map image unavailable');
  const blob = await response.blob();
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  return new Promise((resolve, reject) => {
    const image = new Image(), objectUrl = URL.createObjectURL(blob);
    const cleanup = () => {URL.revokeObjectURL(objectUrl); signal.removeEventListener('abort', abort); image.onload = null; image.onerror = null;};
    const abort = () => {cleanup(); image.src = ''; reject(new DOMException('Aborted', 'AbortError'));};
    image.onload = () => {cleanup(); resolve(image);};
    image.onerror = () => {cleanup(); reject(new Error('Map image unavailable'));};
    signal.addEventListener('abort', abort, {once: true});
    if (signal.aborted) abort(); else image.src = objectUrl;
  });
}

export function ResourceMapCards({cards, locale}: {cards: MapCard[]; locale: Locale}) {
  if (!cards.length) return null;
  return <div className="resource-map-cards">{cards.slice(0, MAX_MAP_CARDS).map(card =>
    <ResourceMapCard key={`${card.snapshotId}:${card.id}`} card={card} locale={locale}/>)}</div>;
}

const ResourceMapCard = memo(function ResourceMapCard({card, locale}: {card: MapCard; locale: Locale}) {
  const zh = locale === 'zh-CN', titleId = useId(), helpId = useId(), detailId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null), controls = useRef<MapControls | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null), [page, setPage] = useState(0);
  const [loadState, setLoadState] = useState<MapLoadState>('loading');
  const [canvasUnavailable, setCanvasUnavailable] = useState(false);
  const [iconFailed, setIconFailed] = useState(false);
  const regionName = !zh && card.region.nameEn || card.region.name;
  const resourceName = !zh && card.resource.nameEn || card.resource.name;
  const location = zh ? [card.region.country,card.region.parentName]
    : [card.region.countryEn,card.region.parentNameEn];
  const selected = card.markers.find(marker => marker.id === selectedId);
  const pageCount = Math.ceil(card.markers.length / PAGE_SIZE);
  const displayedIncluded = card.markers.filter(marker => marker.role === 'included').length;
  const hasNearby = card.markers.some(marker => marker.role === 'nearby');
  const hasReview = card.markers.some(marker => marker.role === 'review');
  const status = zh ? {crosschecked: '三维位置已核对', 'requires-review': '部分位置待复核', 'projected-snapshot': '按地图投影统计'}[card.status]
    : {crosschecked: '3D positions cross-checked', 'requires-review': 'Some positions need review', 'projected-snapshot': 'Projected map count'}[card.status];
  const roleLabel = (marker: MapMarker) => zh
    ? {included: '范围内，计入数量', nearby: '附近参考，不计入数量', review: '待复核，不计入数量'}[marker.role]
    : {included: 'In area · counted', nearby: 'Nearby · not counted', review: 'Needs review · not counted'}[marker.role];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) {setCanvasUnavailable(true); return;}
    const ctx = context;
    const boundaryCanvas = document.createElement('canvas'), boundaryContext = boundaryCanvas.getContext('2d');
    let active = true, frame = 0, activeLoads = 0, sequence = 0, dpr = 1;
    let view: MapViewport = {cx: 0, cy: 0, scale: 1, width: 0, height: 0};
    let base = 1, selected: number | null = null, hits: MapCluster[] = [], icon: MapImage | undefined;
    let wanted = new Set<string>(), fine: MapTile[] = [];
    let moved = false, start: MapPosition | null = null;
    let colors = {paper: '', text: '', muted: '', included: '', nearby: '', review: '', border: '', dark: false, font: ''};
    const tiles = new Map<string, TileEntry>(), pointers = new Map<number, MapPosition>();
    const nativeScale = card.map.tileSize * 2 ** card.map.maxZoom / 360;
    const minScale = () => Math.min(base * .55, nativeScale * 4);
    const maxScale = () => Math.max(base, nativeScale * 4);
    const markerNumbers = new Map(card.markers.map((marker, index) => [marker.id, index + 1]));
    setSelectedId(null); setPage(0); setLoadState('loading'); setCanvasUnavailable(false);

    function schedule() {if (active && !frame) frame = requestAnimationFrame(draw);}
    function palette() {
      const style = getComputedStyle(canvas!);
      colors = {paper: style.getPropertyValue('--panel').trim(), text: style.getPropertyValue('--text').trim(),
        muted: style.getPropertyValue('--muted').trim(), included: style.getPropertyValue('--map-included').trim(),
        nearby: style.getPropertyValue('--map-nearby').trim(), review: style.getPropertyValue('--map-review').trim(),
        border: style.getPropertyValue('--border').trim(), dark: document.documentElement.dataset.theme === 'dark', font: style.fontFamily};
      schedule();
    }
    function clampCenter() {
      view.cx = Math.max(card.map.bounds[0], Math.min(card.map.bounds[2], view.cx));
      view.cy = Math.max(card.map.bounds[1], Math.min(card.map.bounds[3], view.cy));
    }
    function pump() {
      if (!active) return;
      for (const key of wanted) {
        if (activeLoads >= 6) break;
        const entry = tiles.get(key);
        if (!entry || entry.state !== 'queued') continue;
        entry.state = 'loading'; activeLoads++;
        const controller = new AbortController(); entry.controller = controller;
        const timeout = window.setTimeout(() => controller.abort(), 12000);
        loadMapImage(mapTileUrl(card, entry.tile.z, entry.tile.x, entry.tile.sourceY), controller.signal)
          .then(image => {
            if (!active || tiles.get(key) !== entry) {disposeImage(image); return;}
            if (controller.signal.aborted) {disposeImage(image); entry.state = 'error'; return;}
            entry.image = image; entry.state = 'ready';
          }).catch(() => {if (active && tiles.get(key) === entry) entry.state = 'error';})
          .finally(() => {clearTimeout(timeout); activeLoads--; entry.controller = undefined; pump(); schedule();});
      }
    }
    function requestTiles() {
      const zoom = Math.max(card.map.minZoom, Math.min(card.map.maxZoom, Math.ceil(Math.log2(view.scale * dpr * 360 / card.map.tileSize))));
      // Bounds describe the queried area, not a hard crop of the surrounding basemap.
      fine = visibleMapTiles(view, zoom, [-180, -180, 180, 180]);
      const coarse = zoom > card.map.minZoom ? visibleMapTiles(view, zoom - 1, [-180, -180, 180, 180], 24) : [];
      const needed = [...coarse, ...fine]; wanted = new Set(needed.map(tileKey));
      for (const [key, entry] of tiles) {
        if (!wanted.has(key) && entry.state !== 'ready') {entry.controller?.abort(); tiles.delete(key);}
      }
      for (const tile of needed) {
        const key = tileKey(tile), entry = tiles.get(key);
        if (entry) entry.used = ++sequence;
        else tiles.set(key, {tile, state: 'queued', used: ++sequence});
      }
      const stale = [...tiles].filter(([key]) => !wanted.has(key)).sort((a, b) => a[1].used - b[1].used);
      for (const [key, entry] of stale) {
        if (tiles.size <= TILE_CACHE_SIZE) break;
        entry.controller?.abort(); disposeImage(entry.image); tiles.delete(key);
      }
      pump();
    }
    function draw() {
      frame = 0;
      if (!active || !view.width || !view.height) return;
      requestTiles();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = colors.paper; ctx.fillRect(0, 0, view.width, view.height);
      let loaded = 0;
      for (const entry of [...tiles.values()].sort((a, b) => a.tile.z - b.tile.z)) {
        if (!entry.image || entry.state !== 'ready') continue;
        const p = mapToScreen({x: entry.tile.left, y: entry.tile.top}, view), size = entry.tile.size * view.scale;
        if (p.x > view.width || p.y > view.height || p.x + size < 0 || p.y + size < 0) continue;
        ctx.drawImage(entry.image, p.x, p.y, size + .5, size + .5); loaded++;
      }
      if (colors.dark && loaded) {ctx.fillStyle = 'rgba(16, 30, 43, .22)'; ctx.fillRect(0, 0, view.width, view.height);}
      drawMapBoundary(ctx, boundaryContext, view, card.polygons, card.parentPolygons, colors, dpr);
      hits = clusterMapMarkers(card.markers, view, 42, selected);
      hits.sort((a, b) => Number(a.markers[0].id === selected) - Number(b.markers[0].id === selected));
      for (const hit of hits) {
        const point = hit.markers[0], chosen = point.id === selected, clustered = hit.markers.length > 1;
        const radius = clustered ? 23 : chosen ? 22 : 18, ink = colors[point.role];
        ctx.save(); ctx.translate(hit.x, hit.y);
        ctx.shadowColor = 'rgba(10, 25, 35, .3)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
        ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fillStyle = colors.paper; ctx.fill();
        ctx.shadowColor = 'transparent'; ctx.strokeStyle = ink; ctx.lineWidth = chosen ? 3 : 2;
        if (point.role !== 'included') ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
        if (chosen) {ctx.beginPath(); ctx.arc(0, 0, radius + 5, 0, Math.PI * 2); ctx.strokeStyle = colors.paper; ctx.lineWidth = 2; ctx.stroke();}
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if (clustered) {
          ctx.fillStyle = ink; ctx.font = `600 15px ${colors.font}`; ctx.fillText(String(hit.markers.length), 0, 0);
        } else {
          if (icon) {ctx.globalAlpha = point.role === 'nearby' ? .7 : 1; ctx.drawImage(icon, -13, -13, 26, 26); ctx.globalAlpha = 1;}
          else {ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fillStyle = ink; ctx.fill();}
          ctx.beginPath(); ctx.arc(15, -17, 10, 0, Math.PI * 2); ctx.fillStyle = colors.paper; ctx.fill();
          ctx.fillStyle = colors.text; ctx.font = `600 10px ${colors.font}`; ctx.fillText(String(markerNumbers.get(point.id)), 15, -17);
        }
        ctx.restore();
      }
      const errors = [...wanted].filter(key => tiles.get(key)?.state === 'error').length;
      const pending = [...wanted].filter(key => ['queued', 'loading'].includes(tiles.get(key)?.state || '')).length;
      const state = mapTileLoadState({loaded, pending, failed: errors});
      setLoadState(state);
      canvas!.dataset.loadedTiles = String(loaded); canvas!.dataset.zoom = String(view.scale / base);
      canvas!.dataset.pendingTiles = String(pending); canvas!.dataset.failedTiles = String(errors);
      canvas!.dataset.activeLoads = String(activeLoads); canvas!.dataset.tileState = state;
      canvas!.dataset.center = `${view.cx},${view.cy}`; canvas!.dataset.selected = selected ? String(selected) : '';
      canvas!.dataset.clusterCount = String(hits.filter(hit => hit.markers.length > 1).length);
    }
    function resize() {
      const rect = canvas!.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.round(rect.width * dpr); canvas!.height = Math.round(rect.height * dpr);
      const fitted = fitMapViewport(card.map.bounds, rect.width, rect.height, 32);
      if (!view.width) view = fitted;
      else view = {...view, width: rect.width, height: rect.height, scale: Math.min(maxScale(), view.scale * fitted.scale / base)};
      base = fitted.scale; schedule();
    }
    function zoom(factor: number, anchor = {x: view.width / 2, y: view.height / 2}) {
      view = zoomMapViewport(view, factor, anchor, minScale(), maxScale()); clampCenter(); schedule();
    }
    function select(id: number, focus = false) {
      const marker = card.markers.find(point => point.id === id); if (!marker) return;
      selected = id; setSelectedId(id);
      setPage(Math.floor(card.markers.indexOf(marker) / PAGE_SIZE));
      if (focus) {view.cx = marker.x; view.cy = marker.y;}
      schedule();
    }
    function hitTest(position: MapPosition) {
      const hit = [...hits].reverse().find(point => Math.hypot(position.x - point.x, position.y - point.y) <= 28);
      if (!hit) return;
      if (hit.markers.length === 1) select(hit.markers[0].id);
      else {
        const xs = hit.markers.map(marker => marker.x), ys = hit.markers.map(marker => marker.y);
        const fitted = fitMapViewport([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], view.width, view.height, 70);
        view = {...fitted, scale: Math.min(maxScale(), Math.max(view.scale * 1.7, fitted.scale))};
        select(hit.markers[0].id); clampCenter(); schedule();
      }
    }
    const position = (event: {clientX: number; clientY: number}) => {
      const rect = canvas!.getBoundingClientRect(); return {x: event.clientX - rect.left, y: event.clientY - rect.top};
    };
    const midpoint = (points: MapPosition[]) => ({x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2});
    const distance = (points: MapPosition[]) => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    function pointerDown(event: PointerEvent) {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      canvas!.focus({preventScroll: true}); canvas!.setPointerCapture(event.pointerId);
      const p = position(event); pointers.set(event.pointerId, p);
      if (pointers.size === 1) {moved = false; start = p;} else moved = true;
      canvas!.classList.add('is-dragging');
    }
    function pointerMove(event: PointerEvent) {
      const old = pointers.get(event.pointerId); if (!old) return;
      const before = [...pointers.values()], next = position(event); pointers.set(event.pointerId, next);
      if (pointers.size === 2) {
        const after = [...pointers.values()], from = midpoint(before), to = midpoint(after), length = distance(before);
        if (length > 1) view = zoomMapViewport(view, distance(after) / length, from, minScale(), maxScale());
        view.cx -= (to.x - from.x) / view.scale; view.cy -= (to.y - from.y) / view.scale; moved = true;
      } else if (pointers.size === 1) {
        view.cx -= (next.x - old.x) / view.scale; view.cy -= (next.y - old.y) / view.scale;
        if (start && Math.hypot(next.x - start.x, next.y - start.y) > 5) moved = true;
      }
      clampCenter(); schedule();
    }
    function pointerEnd(event: PointerEvent) {
      if (event.type === 'pointerup' && pointers.has(event.pointerId) && pointers.size === 1 && !moved) hitTest(position(event));
      pointers.delete(event.pointerId);
      if (canvas!.hasPointerCapture(event.pointerId)) canvas!.releasePointerCapture(event.pointerId);
      if (!pointers.size) canvas!.classList.remove('is-dragging');
    }
    function wheel(event: WheelEvent) {
      // Scrolling a long answer should not be captured until the reader activates its map.
      if (document.activeElement !== canvas && !event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? view.height : 1);
      zoom(Math.exp(-Math.max(-300, Math.min(300, delta)) * .002), position(event));
    }
    function keydown(event: KeyboardEvent) {
      const pan = 60 / view.scale;
      if (event.key === '+' || event.key === '=') zoom(1.4);
      else if (event.key === '-') zoom(1 / 1.4);
      else if (event.key === 'Home' || event.key === '0') {view = fitMapViewport(card.map.bounds, view.width, view.height, 32); schedule();}
      else if (event.key === 'ArrowLeft') view.cx -= pan;
      else if (event.key === 'ArrowRight') view.cx += pan;
      else if (event.key === 'ArrowUp') view.cy -= pan;
      else if (event.key === 'ArrowDown') view.cy += pan;
      else if (event.key === 'Escape') {selected = null; setSelectedId(null);}
      else return;
      event.preventDefault(); clampCenter(); schedule();
    }
    controls.current = {zoom, reset: () => {view = fitMapViewport(card.map.bounds, view.width, view.height, 32); schedule();},
      select: id => select(id, true), retry: () => {for (const [key, entry] of tiles) if (entry.state === 'error') tiles.delete(key); setLoadState('loading'); schedule();}};
    const iconController = new AbortController(), iconTimeout = window.setTimeout(() => iconController.abort(), 12000);
    loadMapImage(mapIconUrl(card), iconController.signal).then(image => {
      if (!active || iconController.signal.aborted) disposeImage(image); else {icon = image; schedule();}
    }).catch(() => {}).finally(() => clearTimeout(iconTimeout));
    const observer = new ResizeObserver(resize); observer.observe(canvas);
    const themeObserver = new MutationObserver(palette);
    themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme', 'class', 'style']});
    canvas.addEventListener('pointerdown', pointerDown); canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerup', pointerEnd); canvas.addEventListener('pointercancel', pointerEnd);
    canvas.addEventListener('lostpointercapture', pointerEnd);
    canvas.addEventListener('wheel', wheel, {passive: false}); canvas.addEventListener('keydown', keydown);
    window.addEventListener('resize', resize);
    palette(); resize();
    return () => {
      active = false; controls.current = null; cancelAnimationFrame(frame);
      observer.disconnect(); themeObserver.disconnect(); window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerEnd); canvas.removeEventListener('pointercancel', pointerEnd);
      canvas.removeEventListener('lostpointercapture', pointerEnd);
      canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('keydown', keydown);
      for (const id of pointers.keys()) if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
      pointers.clear(); iconController.abort(); clearTimeout(iconTimeout); disposeImage(icon);
      for (const entry of tiles.values()) {entry.controller?.abort(); disposeImage(entry.image);}
      tiles.clear(); canvas.width = 0; canvas.height = 0; boundaryCanvas.width = 0; boundaryCanvas.height = 0;
    };
  }, [card]);

  return <section className="resource-map-card" data-map-card={card.id} data-map-status={card.status} aria-labelledby={titleId}>
    <header className="resource-map-heading">
      <div className="resource-map-resource" aria-hidden="true">
        {iconFailed ? <MapTrifold size={27}/> : <img src={mapIconUrl(card)} alt="" width={36} height={36} onError={() => setIconFailed(true)}/>}
      </div>
      <div className="resource-map-title"><strong id={titleId}>{regionName}<span>{resourceName}</span></strong>
        <span className="resource-map-location">{location.filter(Boolean).join(' / ')}</span></div>
      <div className="resource-map-total"><strong>{card.count.toLocaleString(locale)}</strong><span>{zh ? '个范围内标点' : 'in this area'}</span></div>
    </header>
    <div className="resource-map-scope"><span className="resource-map-status">{status}</span>
      <span>{zh ? '版本' : 'Version'} {card.gameVersion}</span>
      {card.truncated && <span className="resource-map-truncated">{zh ? `范围内共 ${card.count} 个，展示 ${displayedIncluded} 个` : `${displayedIncluded} of ${card.count} in-area points shown`}</span>}
    </div>
    <div className="resource-map-stage">
      <canvas ref={canvasRef} className="resource-map-canvas" tabIndex={0} role="group"
        aria-roledescription={zh ? '交互地图' : 'Interactive map'} aria-label={`${regionName} · ${resourceName}`}
        aria-describedby={helpId}>{zh ? '地图标点可通过下方标点列表查看。' : 'Explore map points using the point list below.'}</canvas>
      <div className="resource-map-compass" aria-hidden="true"><span>N</span><i/></div>
      <div className="resource-map-controls" aria-label={zh ? '地图控制' : 'Map controls'}>
        <button type="button" title={zh ? '放大' : 'Zoom in'} aria-label={zh ? '放大地图' : 'Zoom in map'} onClick={() => controls.current?.zoom(1.4)}><Plus size={18}/></button>
        <button type="button" title={zh ? '缩小' : 'Zoom out'} aria-label={zh ? '缩小地图' : 'Zoom out map'} onClick={() => controls.current?.zoom(1 / 1.4)}><Minus size={18}/></button>
        <button type="button" title={zh ? '回到范围' : 'Fit area'} aria-label={zh ? '回到查询范围' : 'Fit queried area'} onClick={() => controls.current?.reset()}><Crosshair size={19}/></button>
      </div>
      {(loadState !== 'ready' || canvasUnavailable) && <div className={`resource-map-load resource-map-load-${loadState}`} role="status">
        <span>{canvasUnavailable ? (zh ? '此浏览器无法显示地图，请使用下方标点来源。' : 'Map display is unavailable. Use the point sources below.')
          : loadState === 'loading' ? (zh ? '正在加载地图…' : 'Loading map…')
          : loadState === 'partial' ? (zh ? '部分地图细节暂不可用' : 'Some map details are unavailable')
          : (zh ? '底图暂不可用，仍可查看范围与标点。' : 'Basemap unavailable. Area and points remain visible.')}</span>
        {!canvasUnavailable && (loadState === 'error' || loadState === 'partial') && <button type="button" onClick={() => controls.current?.retry()}><ArrowClockwise size={15}/>{zh ? '重试' : 'Retry'}</button>}
      </div>}
    </div>
    <div className="resource-map-legend" aria-label={zh ? '图例' : 'Map legend'}>
      <span><i className="resource-map-boundary"/>{zh ? '统计范围' : 'Queried boundary'}</span>
      <span><i className="resource-map-dot"/>{zh ? '范围内' : 'In area'}</span>
      {hasNearby && <span><i className="resource-map-dot resource-map-nearby"/>{zh ? '附近参考' : 'Nearby'}</span>}
      {hasReview && <span><i className="resource-map-dot resource-map-review"/>{zh ? '待复核' : 'Needs review'}</span>}
    </div>
    <p className="resource-map-help" id={helpId}>{zh ? '拖动地图查看，点击后可滚轮缩放；手机支持双指缩放。' : 'Drag to explore; click the map to enable wheel zoom. Pinch to zoom on mobile.'}
      <span className="sr-only">{zh ? '键盘方向键移动，加减键缩放，Home 回到范围。下方标点列表可逐项查看。' : 'Use arrow keys to pan, plus and minus to zoom, and Home to fit the area. The point list below provides access to every displayed point.'}</span></p>
    <div className="resource-map-detail" id={detailId} aria-live="polite" aria-atomic="true">
      {selected ? <><div><strong>#{selected.id}</strong><span>{roleLabel(selected)}</span>
        <small>{selected.coordinateEvidence === 'crosschecked-3d' ? (zh ? '三维位置已核对' : '3D position cross-checked') : (zh ? '地图投影位置，三维归属未完全核验' : 'Projected position; 3D placement not fully verified')}
          {selected.floor ? ` · ${selected.floor}` : ''}{selected.height != null ? (zh ? ` · 高度 ${selected.height.toFixed(1)}` : ` · Height ${selected.height.toFixed(1)}`) : (zh ? ' · 高度未知' : ' · Height unknown')}</small></div>
        <a href={mapMarkerUrl(card, selected.id)} target="_blank" rel="noopener noreferrer">{zh ? '查看标点来源' : 'View point source'}<ArrowSquareOut size={15}/></a></>
        : <span>{card.markers.length ? (zh ? '选择地图标点或展开列表，查看位置与来源。' : 'Select a point or open the list to see its details and source.') : (zh ? '当前快照在此范围内没有匹配标点。' : 'No matching points in this area in the current snapshot.')}</span>}
    </div>
    {!!card.markers.length && <details className="resource-map-points"><summary>{zh ? `标点列表（${card.markers.length}）` : `Point list (${card.markers.length})`}</summary>
      <div className="resource-map-point-grid">{card.markers.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((marker, index) =>
        <button type="button" key={marker.id} data-map-point={marker.id} aria-pressed={selectedId === marker.id}
          aria-label={`${resourceName} #${marker.id}, ${roleLabel(marker)}`} aria-describedby={selectedId === marker.id ? detailId : undefined}
          onClick={() => {setSelectedId(marker.id); controls.current?.select(marker.id);}}>
          <span className="resource-map-point-number">{page * PAGE_SIZE + index + 1}</span><span>#{marker.id}<small>{roleLabel(marker)}</small></span>
        </button>)}</div>
      {pageCount > 1 && <div className="resource-map-pagination">
        <button type="button" disabled={page === 0} aria-label={zh ? '上一页标点' : 'Previous points'} onClick={() => setPage(value => value - 1)}><CaretLeft size={16}/></button>
        <span aria-live="polite">{page + 1} / {pageCount}</span>
        <button type="button" disabled={page + 1 >= pageCount} aria-label={zh ? '下一页标点' : 'Next points'} onClick={() => setPage(value => value + 1)}><CaretRight size={16}/></button>
      </div>}
    </details>}
    <footer className="resource-map-footer">
      <p>{card.status === 'crosschecked'
        ? (zh ? '按所示围栏统计，范围内标点已核对三维位置；不代表游戏内实时采集状态。' : 'Counted within the shown boundary with cross-checked 3D positions; this does not track in-game collection.')
        : card.status === 'projected-snapshot'
          ? (zh ? '按地图投影与围栏统计，未逐点核验高度及地下归属。' : 'Counted using projected positions and the boundary; heights and underground placement have not all been verified.')
          : (zh ? `需复核：边界 ${card.review.boundary} 个，高度未知 ${card.review.unknownHeight} 个，区域重叠 ${card.review.overlap} 个。分类可能重复，数量不代表全部精确归属。`
            : `Needs review: ${card.review.boundary} boundary, ${card.review.unknownHeight} unknown height, ${card.review.overlap} overlapping-area points. Categories may overlap; exact placement is not fully verified.`)}</p>
      <div><span>{zh ? '数据时间' : 'Data as of'} <time dateTime={card.sourceTime}>{new Intl.DateTimeFormat(locale, {year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC'}).format(new Date(card.sourceTime))}</time></span>
        <nav aria-label={zh ? '地图数据来源' : 'Map data sources'}>{card.sources.map((source, index) => <a key={`${source.url}:${index}`} href={source.url} target="_blank" rel="noopener noreferrer">{source.label}<ArrowSquareOut size={12}/></a>)}</nav></div>
    </footer>
  </section>;
}, (previous, next) => previous.locale === next.locale
  && (previous.card === next.card || JSON.stringify(previous.card) === JSON.stringify(next.card)));
