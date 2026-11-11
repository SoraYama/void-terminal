'use client';

import {useCallback, useEffect, useId, useMemo, useRef, useState} from 'react';
import {ArrowClockwise, Compass, MagnifyingGlass, MapTrifold, WarningCircle, X} from '@phosphor-icons/react';
import type {Locale} from '../../lib/contracts';
import {mapCardSchema, type MapCard} from '../../lib/map-cards';
import {mapCatalogSchema, mapCountryLabel, mapEntryLabel, mapEntryMatches, mapRegionAvailability,
  mapWorkspaceError, mapWorkspaceUrl, readMapWorkspaceQuery, resolveMapWorkspaceQuery,
  type MapCatalog, type MapWorkspaceQuery} from '../../lib/map-workspace';
import {ResourceMapCards} from '../resource-map-card';
import {ThemedSelect} from '../themed-select';
import {Emblem} from '../ui';
import './map-workspace.css';

type Result = {key: string; loading: boolean; card?: MapCard; error?: string};
const emptyQuery: MapWorkspaceQuery = {region: '', resource: '', snapshotId: ''};
const noResult: Result = {key: '', loading: false};
const errorCode = (value: unknown) => value && typeof value === 'object' && 'error' in value && typeof value.error === 'string'
  ? value.error : 'MAP_DATA_UNAVAILABLE';

export function MapWorkspace({locale}: {locale: Locale}) {
  const zh = locale === 'zh-CN', headingId = useId();
  const [query, setQuery] = useState<MapWorkspaceQuery | null>(null);
  const [catalog, setCatalog] = useState<MapCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [catalogRetry, setCatalogRetry] = useState(0), [queryRetry, setQueryRetry] = useState(0);
  const [regionSearch, setRegionSearch] = useState(''), [resourceSearch, setResourceSearch] = useState('');
  const [result, setResult] = useState<Result>(noResult);
  const currentQuery = useRef(query), catalogs = useRef(new Map<string, MapCatalog>());
  currentQuery.current = query;

  const updateQuery = useCallback((next: MapWorkspaceQuery, replace = false) => {
    if (window.location.pathname !== '/map') return;
    currentQuery.current = next;
    setQuery(next);
    const url = mapWorkspaceUrl(next);
    if (`${window.location.pathname}${window.location.search}` !== url) {
      window.history[replace ? 'replaceState' : 'pushState']({...window.history.state, terminalView: 'map'}, '', url);
    }
  }, []);

  // Read after hydration so direct links and client navigation use the same initial markup.
  useEffect(() => {
    const sync = () => {
      if (window.location.pathname !== '/map') return;
      const next = readMapWorkspaceQuery(window.location.search);
      currentQuery.current = next;
      setQuery(next);
      setRegionSearch('');
      setResourceSearch('');
    };
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const requestedSnapshot = query?.snapshotId;
  const invalidLink = query?.error;
  useEffect(() => {
    if (requestedSnapshot === undefined || invalidLink) return;
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    setCatalogError('');
    const accept = (data: MapCatalog) => {
      if (!active) return;
      setCatalog(data);
      setCatalogLoading(false);
      const current = currentQuery.current;
      if (!current || current.snapshotId !== requestedSnapshot) return;
      const resolved = resolveMapWorkspaceQuery(current, data);
      // Pin even an invalid selection to its catalog, without replacing the requested IDs.
      updateQuery({region: resolved.region ? String(resolved.region.id) : current.region,
        resource: resolved.resource?.id || current.resource, snapshotId: data.snapshotId}, true);
    };
    const cached = requestedSnapshot && catalogs.current.get(requestedSnapshot);
    if (cached) {
      clearTimeout(timeout);
      accept(cached);
      return () => {active = false; controller.abort();};
    }
    setCatalogLoading(true);
    setCatalog(null);
    const suffix = requestedSnapshot ? `?${new URLSearchParams({snapshotId: requestedSnapshot})}` : '';
    fetch(`/api/maps/catalog${suffix}`, {signal: controller.signal, credentials: 'same-origin'})
      .then(async response => {
        const body: unknown = await response.json();
        if (!response.ok) throw new Error(errorCode(body));
        const parsed = mapCatalogSchema.safeParse(body);
        if (!parsed.success) throw new Error('MAP_DATA_UNAVAILABLE');
        if (requestedSnapshot && parsed.data.snapshotId !== requestedSnapshot) throw new Error('MAP_RESULT_MISMATCH');
        if (!active) return;
        if (catalogs.current.size >= 2) catalogs.current.delete(catalogs.current.keys().next().value!);
        catalogs.current.set(parsed.data.snapshotId, parsed.data);
        accept(parsed.data);
      }).catch(error => {
        if (active) setCatalogError(error instanceof Error ? error.message : 'MAP_DATA_UNAVAILABLE');
      }).finally(() => {
        clearTimeout(timeout);
        if (active) setCatalogLoading(false);
      });
    return () => {active = false; clearTimeout(timeout); controller.abort();};
  }, [requestedSnapshot, invalidLink, catalogRetry, updateQuery]);

  const selection = useMemo(() => query && catalog && query.snapshotId === catalog.snapshotId
    ? resolveMapWorkspaceQuery(query, catalog) : null, [query, catalog]);
  const region = selection?.region, resource = selection?.resource;
  const resultKey = selection && !selection.error && region && resource
    ? `${catalog!.snapshotId}:${region.id}:${resource.id}` : '';

  useEffect(() => {
    if (!resultKey || !catalog || !region || !resource) return;
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    setResult({key: resultKey, loading: true});
    fetch('/api/maps/query', {method: 'POST', headers: {'Content-Type': 'application/json'},
      credentials: 'same-origin', signal: controller.signal,
      body: JSON.stringify({region: String(region.id), resource: resource.id, snapshotId: catalog.snapshotId,
        ...(region.country ? {country: region.country} : {})})})
      .then(async response => {
        const body: unknown = await response.json();
        if (!response.ok) throw new Error(errorCode(body));
        const parsed = mapCardSchema.safeParse(body && typeof body === 'object' && 'card' in body ? body.card : null);
        if (!parsed.success) throw new Error('MAP_CARD_UNSUPPORTED');
        const card = parsed.data;
        if (card.snapshotId !== catalog.snapshotId || card.region.id !== region.id || card.resource.id !== resource.id) {
          throw new Error('MAP_RESULT_MISMATCH');
        }
        if (active) setResult({key: resultKey, loading: false, card});
      }).catch(error => {
        if (active) setResult({key: resultKey, loading: false,
          error: error instanceof Error ? error.message : 'MAP_DATA_UNAVAILABLE'});
      }).finally(() => clearTimeout(timeout));
    return () => {active = false; clearTimeout(timeout); controller.abort();};
  }, [resultKey, catalog, region, resource, queryRetry]);

  const countryOptions = useMemo(() => catalog ? Array.from(new Set(catalog.regions.map(entry => entry.country)))
    .map(country => ({value: country || '__other', label: mapCountryLabel(country, locale)})) : [], [catalog, locale]);
  const country = region ? region.country || '__other' : countryOptions[0]?.value || '';
  const countryRegions = catalog?.regions.filter(entry => (entry.country || '__other') === country) || [];
  const visibleRegions = countryRegions.filter(entry => mapEntryMatches(entry, regionSearch));
  const visibleResources = catalog?.resources.filter(entry => mapEntryMatches(entry, resourceSearch)) || [];
  const regionOption = (entry: MapCatalog['regions'][number]) => {
    const unavailable = mapRegionAvailability(entry);
    const suffix = unavailable === 'MISSING_BOUNDARY' ? zh ? '无边界' : 'No boundary'
      : unavailable ? zh ? '待校准' : 'Uncalibrated' : '';
    return {value: String(entry.id), label: `${mapEntryLabel(entry, locale)}${suffix ? ` · ${suffix}` : ''}`};
  };
  // Radix keeps the current value visible while the separate search narrows alternatives.
  const regionOptions = (region && !visibleRegions.some(entry => entry.id === region.id) ? [region, ...visibleRegions] : visibleRegions).map(regionOption);
  const resourceOptions = (resource && !visibleResources.some(entry => entry.id === resource.id) ? [resource, ...visibleResources] : visibleResources)
    .map(entry => ({value: entry.id, label: mapEntryLabel(entry, locale)}));
  if (!region) regionOptions.unshift({value: '', label: zh ? '选择区域' : 'Choose a region'});
  if (!resource) resourceOptions.unshift({value: '', label: zh ? '选择资源' : 'Choose a resource'});

  const choose = (patch: Partial<MapWorkspaceQuery>) => {
    if (!query || !catalog) return;
    updateQuery({region: region ? String(region.id) : query.region, resource: resource?.id || query.resource,
      snapshotId: catalog.snapshotId, ...patch});
  };
  const openCurrentCatalog = () => {
    catalogs.current.clear();
    updateQuery({...emptyQuery});
    setCatalogRetry(value => value + 1);
  };
  const failureCode = invalidLink || catalogError || selection?.error || (result.key === resultKey ? result.error : '');
  const failure = failureCode ? mapWorkspaceError(failureCode, locale) : null;
  const card = !failure && result.key === resultKey ? result.card : undefined;
  const loading = !failure && (!query || catalogLoading || !selection || result.key !== resultKey || result.loading);
  const canOpenCurrent = !!invalidLink || failureCode === 'MAP_SNAPSHOT_UNAVAILABLE';

  return <section className="map-workspace" data-map-workspace aria-labelledby={headingId}>
    <header className="map-workspace-header">
      <Emblem/>
      <div><h1 id={headingId}>{zh ? '提瓦特舆图' : 'Teyvat Atlas'}</h1>
        <p>{zh ? '循着地域，寻找散落世间的资源。' : 'Explore Teyvat’s regions and the resources within.'}</p></div>
      {catalog && <span className="map-workspace-version">{zh ? '资料版本' : 'Data version'} {catalog.gameVersion}</span>}
    </header>

    <div className="map-workspace-layout">
      <aside className="map-workspace-catalog" aria-label={zh ? '地图目录' : 'Map catalog'}>
        <div className="map-workspace-catalog-title"><Compass size={20} aria-hidden="true"/><h2>{zh ? '选择探索范围' : 'Choose an area'}</h2></div>
        {catalog && selection ? <>
          <div className="map-workspace-filters">
            <div className="map-workspace-field map-workspace-country"><span>{zh ? '国度' : 'Country'}</span>
              <ThemedSelect label={zh ? '国度' : 'Country'} value={country} options={countryOptions} onValueChange={next => {
                const candidates = catalog.regions.filter(entry => (entry.country || '__other') === next);
                const selected = candidates.find(entry => !mapRegionAvailability(entry)) || candidates[0];
                if (selected) choose({region: String(selected.id)});
                setRegionSearch('');
              }}/>
            </div>
            <div className="map-workspace-field">
              <div className="map-workspace-field-label"><span>{zh ? '区域' : 'Region'}</span><small>{visibleRegions.length} / {countryRegions.length}</small></div>
              <CatalogSearch label={zh ? '搜索区域' : 'Search regions'} placeholder={zh ? '名称或区域编号' : 'Name or region ID'} value={regionSearch} onChange={setRegionSearch} locale={locale}/>
              <ThemedSelect label={zh ? '区域' : 'Region'} value={region ? String(region.id) : ''} options={regionOptions} onValueChange={value => {
                if (value) choose({region: value});
                setRegionSearch('');
              }}/>
              {regionSearch && !visibleRegions.length && <p className="map-workspace-filter-empty" role="status">{zh ? '此国度没有匹配区域。请修改搜索词。' : 'No matching regions in this country. Try another search.'}</p>}
            </div>
            <div className="map-workspace-field">
              <div className="map-workspace-field-label"><span>{zh ? '资源' : 'Resource'}</span><small>{visibleResources.length} / {catalog.resources.length}</small></div>
              <CatalogSearch label={zh ? '搜索资源' : 'Search resources'} placeholder={zh ? '神瞳、矿物、采集物…' : 'Oculi, ores, materials…'} value={resourceSearch} onChange={setResourceSearch} locale={locale}/>
              <ThemedSelect label={zh ? '资源' : 'Resource'} value={resource?.id || ''} options={resourceOptions} onValueChange={value => {
                if (value) choose({resource: value});
                setResourceSearch('');
              }}/>
              {resourceSearch && !visibleResources.length && <p className="map-workspace-filter-empty" role="status">{zh ? '没有匹配资源。请修改搜索词。' : 'No matching resources. Try another search.'}</p>}
            </div>
          </div>
          <div className="map-workspace-catalog-note">
            <p>{zh ? '选择后自动更新地图。待校准或缺少边界的区域暂不提供数量。' : 'The map updates when you select an area or resource. Uncalibrated areas and missing boundaries cannot provide counts.'}</p>
            <span>{zh ? '数据时间' : 'Data as of'} <time dateTime={catalog.sourceTime}>{new Intl.DateTimeFormat(locale, {year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC'}).format(new Date(catalog.sourceTime))}</time></span>
          </div>
        </> : <div className="map-workspace-catalog-placeholder" aria-busy={catalogLoading && !failure}>
          <MapTrifold size={32} aria-hidden="true"/>
          <p>{failure ? (zh ? '目录尚未载入' : 'Catalog not loaded') : (zh ? '正在读取区域与资源目录…' : 'Loading regions and resources…')}</p>
        </div>}
      </aside>

      <div className="map-workspace-result" aria-busy={loading}>
        {card ? <ResourceMapCards cards={[card]} locale={locale}/>
          : <div className="map-workspace-state" role={failure ? 'alert' : 'status'}>
            {failure ? <WarningCircle size={40} aria-hidden="true"/> : <MapTrifold size={40} aria-hidden="true"/>}
            <h2>{failure ? failure.title : zh ? '正在展开舆图…' : 'Opening the atlas…'}</h2>
            <p>{failure ? failure.detail : region && resource
              ? `${mapEntryLabel(region, locale)} · ${mapEntryLabel(resource, locale)}`
              : zh ? '读取地图目录与边界信息。' : 'Loading the catalog and region boundaries.'}</p>
            {failure && <div className="map-workspace-state-actions">
              {failure.retryable && <button type="button" onClick={() => catalogError ? setCatalogRetry(value => value + 1) : setQueryRetry(value => value + 1)}><ArrowClockwise size={17}/>{zh ? '重试加载' : 'Retry loading'}</button>}
              {canOpenCurrent && <button type="button" onClick={openCurrentCatalog}>{zh ? '打开当前地图目录' : 'Open current catalog'}</button>}
            </div>}
          </div>}
      </div>
    </div>
  </section>;
}

function CatalogSearch({label, placeholder, value, onChange, locale}: {
  label: string; placeholder: string; value: string; onChange: (value: string) => void; locale: Locale;
}) {
  return <div className="map-workspace-search">
    <MagnifyingGlass size={17} aria-hidden="true"/>
    <input type="search" aria-label={label} placeholder={placeholder} value={value} maxLength={200} autoComplete="off"
      onChange={event => onChange(event.target.value)}/>
    {value && <button type="button" aria-label={locale === 'zh-CN' ? `清除${label}` : `Clear ${label.toLocaleLowerCase('en')}`} onClick={() => onChange('')}><X size={15}/></button>}
  </div>;
}
