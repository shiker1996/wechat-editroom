import { createHash } from 'node:crypto';

function normalizeSourceUrl(value) {
  try {
    const url=new URL(String(value||'').trim());
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return '';
    url.hash='';
    return url.href;
  } catch { return ''; }
}

export function collectCandidateImageSources(candidate,store) {
  const hotspots=candidate?.composite
    ? store.candidateHotspots(candidate.id)
    : [candidate?.hotspot_id?store.getHotspot(candidate.hotspot_id):null].filter(Boolean);
  const rows=[...(store.listCandidateSources(candidate.id)||[])];
  for(const hotspot of hotspots){
    rows.push({url:hotspot.url,title:hotspot.title,source:hotspot.source_name||hotspot.source,content:''});
    const primary=store.getHotspotSource(hotspot.id);
    if(primary)rows.push(primary);
    rows.push(...(store.listHotspotMaterials(hotspot.id)||[]));
  }
  const unique=new Map();
  for(const source of rows){
    const url=normalizeSourceUrl(source?.final_url||source?.url);
    if(!url)continue;
    const sourceId=`src-${createHash('sha256').update(url).digest('hex').slice(0,12)}`;
    const previous=unique.get(sourceId);
    const normalized={...source,sourceId,url,title:String(source?.title||'').trim(),
      description:String(source?.description||'').trim(),content:String(source?.content||'').trim()};
    if(!previous||normalized.content.length>previous.content.length)unique.set(sourceId,normalized);
  }
  return [...unique.values()].sort((a,b)=>{
    const status=(value)=>String(value||'').toLowerCase()==='ok'?1:0;
    return status(b.status)-status(a.status)||b.content.length-a.content.length||a.title.localeCompare(b.title);
  });
}
