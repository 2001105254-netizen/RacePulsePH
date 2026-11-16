function can(s, key) { return s?.permissions?.[key] === true; }
function scope(s, raceId) { return s?.scope === 'all' || (s?.allowedRaceIds || []).includes(raceId); }
function visible(s, type, record) {
  if (type === 'orders') return can(s, 'engraving.view') || (can(s, 'personal.engraving') && record.ownerUid === s.uid);
  return (can(s, 'timing.view') && scope(s, record.raceId)) || (can(s, 'personal.results') && (s.ownSplits || []).some(r => r.raceId === record.raceId && r.bibNumber === record.bibNumber));
}
function authorize(s, method, route, body, existing) {
  if (!s?.uid || typeof route !== 'string') return false;
  const cleanRoute = route.replace(/\/+$/, '') || '/';
  const payload = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (cleanRoute === '/api/orders/reset' || cleanRoute === '/api/chip-reads/reset') {
    return method === 'POST' && s.authority === true && (cleanRoute.startsWith('/api/orders') || s.scope === 'all');
  }
  if (cleanRoute === '/api/rfid-events') return method === 'GET' && can(s, 'timing.scan') && typeof payload.raceId === 'string' && scope(s, payload.raceId);
  if (method === 'GET') return true;
  if (cleanRoute === '/api/orders' || /^\/api\/orders\/[^/]+$/.test(cleanRoute)) {
    if (method === 'DELETE' && cleanRoute !== '/api/orders') return s.authority === true || (can(s, 'personal.engraving') && existing?.ownerUid === s.uid && existing?.status === 'queued');
    if (method !== 'POST' || cleanRoute !== '/api/orders') return false;
    if (!existing) return payload.status === 'queued' && (can(s, 'engraving.create') || (can(s, 'personal.engraving') && payload.ownerUid === s.uid));
    return can(s, 'engraving.status') && (!payload.status || ['queued', 'inprogress', 'ready', 'completed'].includes(payload.status)) && Object.keys(payload).every(key => ['status','updatedAt'].includes(key) || JSON.stringify(payload[key]) === JSON.stringify(existing[key]));
  }
  if (cleanRoute === '/api/chip-reads' || /^\/api\/chip-reads\/[^/]+$/.test(cleanRoute)) {
    if (method === 'DELETE' && cleanRoute !== '/api/chip-reads') return !!existing && scope(s, existing.raceId) && (s.authority === true || can(s, 'timing.correct'));
    return method === 'POST' && cleanRoute === '/api/chip-reads' && can(s, 'timing.scan') && payload.recordedBy === s.uid && typeof payload.raceId === 'string' && scope(s, payload.raceId) && (!existing || ['raceId','bibNumber','chipId','checkpointId','timestamp','source','recordedBy'].every(key => payload[key] === existing[key]));
  }
  return false;
}
module.exports = { can, scope, visible, authorize };
