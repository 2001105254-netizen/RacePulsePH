function can(s, key) { return s?.permissions?.[key] === true; }
function scope(s, raceId) { return s?.scope === 'all' || (s?.allowedRaceIds || []).includes(raceId); }
function visible(s, type, record) {
  if (type === 'orders') return can(s, 'engraving.view') || (can(s, 'personal.engraving') && record.ownerUid === s.uid);
  return (can(s, 'timing.view') && scope(s, record.raceId)) || (can(s, 'personal.results') && (s.ownSplits || []).some(r => r.raceId === record.raceId && r.bibNumber === record.bibNumber));
}
function authorize(s, method, route, body, existing) {
  if (!s?.uid) return false;
  if (route.endsWith('/reset')) return s.authority === true && (route.startsWith('/api/orders') || s.scope === 'all');
  if (route === '/api/rfid-events') return method === 'GET' && can(s, 'timing.scan') && scope(s, body.raceId);
  if (method === 'GET') return true;
  if (route.startsWith('/api/orders')) {
    if (method === 'DELETE') return s.authority === true || (can(s, 'personal.engraving') && existing?.ownerUid === s.uid && existing?.status === 'queued');
    if (method !== 'POST') return false;
    if (!existing) return body.status === 'queued' && (can(s, 'engraving.create') || (can(s, 'personal.engraving') && body.ownerUid === s.uid));
    return can(s, 'engraving.status') && Object.keys(body).every(key => ['status','updatedAt'].includes(key) || JSON.stringify(body[key]) === JSON.stringify(existing[key]));
  }
  if (route.startsWith('/api/chip-reads')) {
    if (method === 'DELETE') return !!existing && scope(s, existing.raceId) && (s.authority === true || can(s, 'timing.correct'));
    return method === 'POST' && can(s, 'timing.scan') && body.recordedBy === s.uid && scope(s, body.raceId) && (!existing || ['raceId','bibNumber','chipId','checkpointId','timestamp','source','recordedBy'].every(key => body[key] === existing[key]));
  }
  return false;
}
module.exports = { can, scope, visible, authorize };
