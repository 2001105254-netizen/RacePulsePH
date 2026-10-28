const crypto = require('crypto');
const policy = require('./access-policy');
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function createAccessService(db) {
  const userRef = uid => db.doc(`users/${uid}`), accessRef = uid => db.doc(`userAccess/${uid}`);
  async function execute(actorUid, path, input) {
    const [actorDoc, actorState] = await Promise.all([userRef(actorUid).get(), accessRef(actorUid).get()]);
    const actor = actorDoc.exists ? { ...actorDoc.data(), uid: actorUid } : null;
    if (!actor) fail('Your app account is unavailable.', 403);
    const actorAccess = policy.accessFor(actor, actorState.data());
    if (actorAccess.status !== 'active') fail('Your account access is suspended.', 403);
    if (path === '/session') {
      if (!actorState.exists) {
        await db.runTransaction(async tx => {
          const [latestUser, latestAccess] = await Promise.all([tx.get(userRef(actorUid)), tx.get(accessRef(actorUid))]);
          if (!latestAccess.exists && latestUser.exists) {
            const baseline = policy.accessFor(latestUser.data());
            baseline.permissions = Object.fromEntries(policy.keys.map(key => [key, policy.can(latestUser.data(), baseline, key)]));
            tx.create(accessRef(actorUid), baseline);
          }
        });
      }
      if (input?.scanningRaceId) {
        if (typeof input.scanningRaceId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.scanningRaceId)) fail('Invalid race.');
        const race = await db.doc(`races/${input.scanningRaceId}`).get();
        if (!race.exists || race.data().completedAt || !policy.can(actor, actorAccess, 'timing.scan') || !policy.inScope(actor, actorAccess, { ...race.data(), id: race.id })) fail('Timing is unavailable for this race.', 403);
      }
      let allowedRaceIds = actorAccess.raceIds;
      if (actorAccess.scope === 'owned-assigned') {
        const lists = await Promise.all([db.collection('races').where('createdBy', '==', actorUid).get(), db.collection('races').where('organizerIds', 'array-contains', actorUid).get()]);
        allowedRaceIds = [...new Set(lists.flatMap(list => list.docs.map(doc => doc.id)))];
      }
      const ownSplits = policy.can(actor, actorAccess, 'personal.results') ? (await db.collection('runners').where('uid', '==', actorUid).get()).docs.map(doc => ({ raceId: doc.data().raceId, bibNumber: doc.data().bibNumber })) : [];
      return { uid: actorUid, role: actor.role, authority: policy.isAuthority(actor, actorAccess), permissions: Object.fromEntries(policy.keys.map(key => [key, policy.can(actor, actorAccess, key)])), scope: actorAccess.scope, allowedRaceIds, ownSplits, revision: actorAccess.revision };
    }
    if (!policy.isAuthority(actor, actorAccess)) fail('Super Admin access required.', 403);
    if (typeof input?.uid !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.uid)) fail('Invalid user.');
    if (path === '/history') {
      const rows = await db.collection('accessHistory').where('targetUid', '==', input.uid).orderBy('at', 'desc').limit(100).get();
      return { history: rows.docs.map(doc => ({ id: doc.id, ...doc.data() })) };
    }
    if (!['/save', '/restore', '/remove'].includes(path)) fail('Unknown access command.', 404);
    if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(input.requestId)) fail('Invalid request ID.');
    if (!Number.isInteger(input.revision) || input.revision < 0) fail('Invalid revision.');
    const rollout = await db.doc('accessSystem/rollout').get();
    if (rollout.data()?.enforcementReady !== true) fail('Access changes are awaiting rollout activation.', 409);
    const digest = crypto.createHash('sha256').update(JSON.stringify({ path, input })).digest('hex');
    const historyRef = db.doc(`accessHistory/${actorUid}_${input.requestId}`);
    await db.runTransaction(async tx => {
      const registryRef = db.doc('accessSystem/authority');
      const [freshActor, freshActorAccess, target, access, previous, registry, restore] = await Promise.all([
        tx.get(userRef(actorUid)), tx.get(accessRef(actorUid)), tx.get(userRef(input.uid)), tx.get(accessRef(input.uid)), tx.get(historyRef), tx.get(registryRef),
        path === '/restore' && typeof input.historyId === 'string' && /^[a-zA-Z0-9_-]{1,256}$/.test(input.historyId) ? tx.get(db.doc(`accessHistory/${input.historyId}`)) : Promise.resolve(null),
      ]);
      if (!policy.isAuthority(freshActor.data(), freshActorAccess.data())) fail('Super Admin access required.', 403);
      if (previous.exists) { if (previous.data().digest !== digest) fail('Request ID already used.', 409); return; }
      if (!target.exists) fail('User no longer exists.', 404);
      if ((access.data()?.revision || 0) !== input.revision) fail('Access changed. Reload this user and review your changes.', 409);
      let change = input;
      if (path === '/restore') {
        if (!restore?.exists || restore.data().targetUid !== input.uid || !restore.data().after?.access) fail('Invalid history entry.');
        change = { ...restore.data().after.access, role: restore.data().after.role, approved: restore.data().after.approved, revision: input.revision };
      }
      if (path === '/remove') change = { ...policy.accessFor(target.data(), access.data()), revision: input.revision, role: target.data().role, status: 'suspended' };
      const next = policy.validate(change);
      const approved = change.role === 'organizer' ? (path === '/remove' ? false : change.approved ?? target.data().approved ?? false) : true;
      if (input.uid === actorUid && (change.role !== 'superadmin' || next.status !== 'active' || path === '/remove')) fail('You cannot remove your own Super Admin access.');
      if (target.data().role === 'superadmin' || change.role === 'superadmin') {
        if (!registry.exists || !Array.isArray(registry.data().members)) fail('Authority registry is unavailable.', 409);
        const members = new Set(registry.data().members);
        if (change.role === 'superadmin' && next.status === 'active' && path !== '/remove') members.add(input.uid); else members.delete(input.uid);
        if (!members.size) fail('At least one active Super Admin must remain.');
        tx.set(registryRef, { members: [...members] });
      }
      const at = new Date().toISOString();
      const after = { ...next, revision: input.revision + 1, updatedBy: actorUid, updatedAt: at };
      after.permissions = Object.fromEntries(policy.keys.map(key => [key, policy.can({ ...target.data(), role: change.role, approved }, after, key)]));
      tx.set(accessRef(input.uid), after);
      const accessRemoved = path === '/remove' || (next.status !== 'active' && target.data().accessRemoved === true);
      tx.update(userRef(input.uid), { role: change.role, approved, accessRemoved });
      if (path === '/remove') tx.set(db.doc(`removedAccounts/${input.uid}`), { removedAt: at, email: target.data().email || '' });
      else if (next.status === 'active' && target.data().accessRemoved) tx.delete(db.doc(`removedAccounts/${input.uid}`));
      tx.create(historyRef, { targetUid: input.uid, actorUid, actorName: actor.displayName || actor.email || actorUid, at, digest, action: path.slice(1), restoreSource: path === '/restore' ? input.historyId : null,
        before: { role: target.data().role, approved: target.data().approved, access: policy.accessFor(target.data(), access.data()) }, after: { role: change.role, approved, access: after } });
    });
    return { saved: true };
  }
  return { execute };
}
module.exports = { createAccessService };
