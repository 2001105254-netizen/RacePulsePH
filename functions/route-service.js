const crypto = require('crypto');
const policy = require('./access-policy');

const VALID_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const VALID_REQUEST_ID_RE = /^[a-zA-Z0-9-]{16,64}$/;

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function assertId(value, label) {
  if (typeof value !== 'string' || !VALID_ID_RE.test(value)) {
    fail(`Invalid ${label}.`, 400);
  }
  return value;
}

function assertText(value, maxLen, label, required = true) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (required && !trimmed) fail(`${label} is required.`, 400);
  if (trimmed.length > maxLen) fail(`${label} exceeds ${maxLen} characters.`, 400);
  return trimmed;
}

function canEditPreset(actor, actorAccess, preset) {
  if (policy.isAuthority(actor, actorAccess)) return true;
  if (actor.role === 'admin' && policy.can(actor, actorAccess, 'routes.view')) return true;
  if (!preset) return false;
  return preset.ownerUid === actor.uid || (Array.isArray(preset.editorIds) && preset.editorIds.includes(actor.uid));
}

function computeHash(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

function validateMarkersForPublish(markers, raceCheckpoints) {
  const list = Array.isArray(markers) ? markers : [];
  if (list.length > 200) fail('Maximum 200 markers allowed per course.', 400);

  const hasStart = list.some((m) => m.kind === 'start');
  const hasFinish = list.some((m) => m.kind === 'finish');
  if (!hasStart || !hasFinish) {
    fail('Start and Finish markers are required before publishing.', 400);
  }

  for (const m of list) {
    if (m.offsetMeters > 100 && !m.offCourseConfirmed) {
      fail(`Marker "${m.name}" is ${Math.round(m.offsetMeters)} m off course and requires explicit off-course confirmation.`, 400);
    }
    if (m.offCourseConfirmed && (!m.offCourseInstruction || !String(m.offCourseInstruction).trim())) {
      fail(`Off-course marker "${m.name}" requires access instructions.`, 400);
    }
    const photos = Array.isArray(m.photos) ? m.photos : [];
    if (photos.length > 3) fail(`Marker "${m.name}" exceeds 3 photos.`, 400);
    for (const p of photos) {
      if (!p.rightsConfirmed || !String(p.altText || '').trim() || !String(p.caption || '').trim() || !String(p.credit || '').trim()) {
        fail(`Photo on "${m.name}" requires caption, alt text, photographer credit, and rights confirmation.`, 400);
      }
    }
  }

  // Validate timing checkpoint links preserve official race checkpoint order
  if (Array.isArray(raceCheckpoints) && raceCheckpoints.length > 0) {
    const orderById = new Map(raceCheckpoints.map((cp, idx) => [cp.id, cp.order ?? idx]));
    const linked = list
      .filter((m) => m.kind === 'timing' && m.timingCheckpointId)
      .sort((a, b) => a.chainageM - b.chainageM || (a.passNumber || 1) - (b.passNumber || 1));

    let lastOrder = -1;
    for (const item of linked) {
      if (!orderById.has(item.timingCheckpointId)) {
        fail(`Timing marker "${item.name}" links to unknown race checkpoint "${item.timingCheckpointId}".`, 400);
      }
      const order = orderById.get(item.timingCheckpointId);
      if (order < lastOrder && (item.passNumber || 1) <= 1) {
        fail(`Timing checkpoint order mismatch at "${item.name}".`, 400);
      }
      lastOrder = order;
    }
  }
}

function createRouteService(db, storage = null) {
  const userRef = (uid) => db.doc(`users/${uid}`);
  const accessRef = (uid) => db.doc(`userAccess/${uid}`);

  async function writeStorageAsset(objectPath, content, contentType) {
    if (!storage) return null;
    try {
      const file = storage.bucket().file(objectPath);
      await file.save(content, { contentType, resumable: false });
      return objectPath;
    } catch {
      return null;
    }
  }

  async function execute(actorUid, path, input) {
    const [actorDoc, actorState] = await Promise.all([
      userRef(actorUid).get(),
      accessRef(actorUid).get(),
    ]);
    const actor = actorDoc.exists ? { ...actorDoc.data(), uid: actorUid } : null;
    if (!actor) fail('Your app account is unavailable.', 403);
    const actorAccess = policy.accessFor(actor, actorState.data());
    if (actorAccess.status !== 'active') fail('Your account access is suspended.', 403);

    const requestId = input?.requestId;
    if (typeof requestId !== 'string' || !VALID_REQUEST_ID_RE.test(requestId)) {
      fail('Valid requestId is required.', 400);
    }

    const reqDigest = computeHash({ path, input });
    const idempRef = db.doc(`routeIdempotency/${actorUid}_${requestId}`);
    const existingIdemp = await idempRef.get();
    if (existingIdemp.exists) {
      if (existingIdemp.data().digest !== reqDigest) {
        fail('Request ID already used for a different operation.', 409);
      }
      return existingIdemp.data().response;
    }

    const now = new Date().toISOString();
    const actorName = actor.displayName || actor.email || actorUid;

    const recordAudit = (tx, event) => {
      const eventId = `audit_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
      tx.create(db.doc(`routeAudit/${eventId}`), {
        id: eventId,
        actorUid,
        actorName,
        at: now,
        ...event,
      });
    };

    let result;

    if (path === '/create-preset') {
      if (!policy.can(actor, actorAccess, 'routes.create')) {
        fail('You do not have permission to create route presets.', 403);
      }
      const presetId = input.presetId ? assertId(input.presetId, 'preset ID') : `preset_${crypto.randomUUID().slice(0, 12)}`;
      const draftId = input.draftId ? assertId(input.draftId, 'draft ID') : 'draft_main';
      const title = assertText(input.title, 120, 'Course title');
      const region = assertText(input.region || 'Philippines', 80, 'Region');
      const activity = ['road', 'trail', 'mixed'].includes(input.activity) ? input.activity : 'road';

      const preset = {
        id: presetId,
        title,
        region,
        activity,
        ownerUid: actorUid,
        editorIds: [],
        archived: false,
        latestDraftId: draftId,
        latestVersionNumber: 0,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        updatedBy: actorUid,
      };
      const draft = {
        id: draftId,
        presetId,
        title,
        region,
        revision: 1,
        processingState: input.processingState || 'needs_review',
        canonicalGeometry: input.canonicalGeometry,
        elevationProvenance: input.elevationProvenance,
        validationReport: input.validationReport,
        markers: Array.isArray(input.markers) ? input.markers : [],
        distanceM: Number(input.distanceM || 0),
        elevationGainM: Number(input.elevationGainM || 0),
        elevationLossM: Number(input.elevationLossM || 0),
        editSummary: assertText(input.editSummary || 'Initial course draft', 240, 'Edit summary', false),
        ...(input.mapLayerProvenance ? { mapLayerProvenance: input.mapLayerProvenance } : {}),
        updatedAt: now,
        updatedBy: actorUid,
      };

      await db.runTransaction(async (tx) => {
        const ref = db.doc(`routePresets/${presetId}`);
        const snap = await tx.get(ref);
        if (snap.exists) fail('Preset ID already exists.', 409);
        tx.create(ref, preset);
        tx.create(db.doc(`routePresets/${presetId}/drafts/${draftId}`), draft);
        recordAudit(tx, { action: 'create_preset', presetId, draftId, reason: title });
        tx.create(idempRef, { digest: reqDigest, response: { preset, draft }, at: now });
      });

      await writeStorageAsset(
        `route-private/${actorUid}/${presetId}/${draftId}-geometry.json`,
        JSON.stringify(draft.canonicalGeometry),
        'application/json',
      );
      result = { preset, draft };
    } else if (path === '/save-draft') {
      if (!policy.can(actor, actorAccess, 'routes.edit')) {
        fail('You do not have permission to edit route drafts.', 403);
      }
      const presetId = assertId(input.presetId, 'preset ID');
      const draftId = assertId(input.draftId || 'draft_main', 'draft ID');
      const expectedRevision = input.expectedRevision;
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
        fail('expectedRevision is required.', 400);
      }

      const updatedDraft = await db.runTransaction(async (tx) => {
        const presetRef = db.doc(`routePresets/${presetId}`);
        const draftRef = db.doc(`routePresets/${presetId}/drafts/${draftId}`);
        const [presetSnap, draftSnap] = await Promise.all([tx.get(presetRef), tx.get(draftRef)]);
        if (!presetSnap.exists) fail('Route preset not found.', 404);
        const preset = presetSnap.data();
        if (!canEditPreset(actor, actorAccess, preset)) fail('You cannot edit this preset.', 403);
        const currentRev = draftSnap.exists ? draftSnap.data().revision : 0;
        if (currentRev !== expectedRevision) {
          fail('Draft revision conflict. Another edit was saved since you loaded this course.', 409);
        }
        const nextRevision = currentRev + 1;
        const nextDraft = {
          id: draftId,
          presetId,
          title: assertText(input.title || preset.title, 120, 'Course title'),
          region: assertText(input.region || preset.region, 80, 'Region'),
          revision: nextRevision,
          processingState: input.processingState || 'ready',
          sourceFileName: input.sourceFileName || null,
          sourceHash: input.sourceHash || null,
          sourceBytes: Number(input.sourceBytes || 0),
          selectedTrackIndices: Array.isArray(input.selectedTrackIndices) ? input.selectedTrackIndices : [0],
          canonicalGeometry: input.canonicalGeometry,
          elevationProvenance: input.elevationProvenance,
          validationReport: input.validationReport,
          markers: Array.isArray(input.markers) ? input.markers : [],
          distanceM: Number(input.distanceM || 0),
          elevationGainM: Number(input.elevationGainM || 0),
          elevationLossM: Number(input.elevationLossM || 0),
          editSummary: assertText(input.editSummary || 'Updated course draft', 240, 'Edit summary', false),
          ...(input.mapLayerProvenance ? { mapLayerProvenance: input.mapLayerProvenance } : {}),
          updatedAt: now,
          updatedBy: actorUid,
        };
        tx.set(draftRef, nextDraft);
        tx.update(presetRef, {
          title: nextDraft.title,
          region: nextDraft.region,
          revision: (preset.revision || 0) + 1,
          updatedAt: now,
          updatedBy: actorUid,
        });
        recordAudit(tx, { action: 'save_draft', presetId, draftId, reason: nextDraft.editSummary });
        tx.create(idempRef, { digest: reqDigest, response: { draft: nextDraft }, at: now });
        return nextDraft;
      });
      result = { draft: updatedDraft };
    } else if (path === '/create-version') {
      if (!policy.can(actor, actorAccess, 'routes.publish')) {
        fail('You do not have permission to create reviewed route versions.', 403);
      }
      const presetId = assertId(input.presetId, 'preset ID');
      const draftId = assertId(input.draftId || 'draft_main', 'draft ID');
      const expectedRevision = input.expectedRevision;
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
        fail('expectedRevision is required.', 400);
      }

      const createdVersion = await db.runTransaction(async (tx) => {
        const presetRef = db.doc(`routePresets/${presetId}`);
        const draftRef = db.doc(`routePresets/${presetId}/drafts/${draftId}`);
        const [presetSnap, draftSnap] = await Promise.all([tx.get(presetRef), tx.get(draftRef)]);
        if (!presetSnap.exists || !draftSnap.exists) fail('Preset or draft not found.', 404);
        const preset = presetSnap.data();
        const draft = draftSnap.data();
        if (!canEditPreset(actor, actorAccess, preset)) fail('You cannot version this preset.', 403);
        if (draft.revision !== expectedRevision) {
          fail('Draft changed since review began. Reload before creating a version.', 409);
        }

        const nextVerNum = (preset.latestVersionNumber || 0) + 1;
        const versionId = `${presetId}_v${nextVerNum}`;
        const geometryHash = computeHash(draft.canonicalGeometry);
        const version = {
          id: versionId,
          presetId,
          versionNumber: nextVerNum,
          title: draft.title,
          region: draft.region,
          geometryHash,
          canonicalGeometry: draft.canonicalGeometry,
          elevationProvenance: draft.elevationProvenance,
          validationReport: draft.validationReport,
          markers: draft.markers || [],
          distanceM: draft.distanceM,
          elevationGainM: draft.elevationGainM,
          elevationLossM: draft.elevationLossM,
          reviewNotes: assertText(input.reviewNotes || 'Reviewed for race binding', 300, 'Review notes', false),
          ...(draft.mapLayerProvenance ? { mapLayerProvenance: draft.mapLayerProvenance } : {}),
          reviewedBy: actorUid,
          reviewedAt: now,
          createdAt: now,
        };
        tx.create(db.doc(`routePresets/${presetId}/versions/${versionId}`), version);
        tx.update(presetRef, {
          latestVersionId: versionId,
          latestVersionNumber: nextVerNum,
          revision: (preset.revision || 0) + 1,
          updatedAt: now,
          updatedBy: actorUid,
        });
        recordAudit(tx, { action: 'create_version', presetId, versionId, reason: version.reviewNotes });
        tx.create(idempRef, { digest: reqDigest, response: { version }, at: now });
        return version;
      });
      result = { version: createdVersion };
    } else if (path === '/bind-publish') {
      if (!policy.can(actor, actorAccess, 'routes.assign') || !policy.can(actor, actorAccess, 'routes.publish')) {
        fail('You need route publish and race assignment permissions.', 403);
      }
      const raceId = assertId(input.raceId, 'race ID');
      const distanceId = assertId(input.distanceId, 'distance ID');
      const presetId = assertId(input.presetId, 'preset ID');
      const versionId = assertId(input.versionId, 'version ID');
      const expectedBindingRevision = Number(input.expectedBindingRevision ?? 0);

      const pubResult = await db.runTransaction(async (tx) => {
        const raceRef = db.doc(`races/${raceId}`);
        const presetRef = db.doc(`routePresets/${presetId}`);
        const versionRef = db.doc(`routePresets/${presetId}/versions/${versionId}`);
        const bindingRef = db.doc(`races/${raceId}/routeBindings/${distanceId}`);
        const [raceSnap, presetSnap, versionSnap, bindingSnap] = await Promise.all([
          tx.get(raceRef),
          tx.get(presetRef),
          tx.get(versionRef),
          tx.get(bindingRef),
        ]);
        if (!raceSnap.exists) fail('Race not found.', 404);
        if (!presetSnap.exists || !versionSnap.exists) fail('Preset version not found.', 404);
        const race = { ...raceSnap.data(), id: raceSnap.id };
        if (!policy.inScope(actor, actorAccess, race)) fail('Race is outside your access scope.', 403);
        if (!canEditPreset(actor, actorAccess, presetSnap.data())) fail('Preset is outside your access scope.', 403);

        const distance = (race.distances || []).find((d) => d.id === distanceId);
        if (!distance) fail('Race distance category not found.', 404);

        const raceStarted = Boolean(race.gunStartTime || race.completedAt || (race.waveStartTimes && Object.keys(race.waveStartTimes).length > 0));
        if (raceStarted && !input.overrideFreeze) {
          fail('Race-day freeze is active because timing has started. Explicit freeze override with a written reason is required.', 409);
        }
        if (raceStarted && input.overrideFreeze && !String(input.reason || '').trim()) {
          fail('A written correction reason is required to override the race-day freeze.', 400);
        }

        const currentBindingRev = bindingSnap.exists ? bindingSnap.data().bindingRevision || 0 : 0;
        if (currentBindingRev !== expectedBindingRevision) {
          fail('Race binding changed concurrently. Reload before publishing.', 409);
        }

        const version = versionSnap.data();
        const checkpointLinks = input.checkpointLinks || {};
        const mergedMarkers = (version.markers || []).map((m) => ({
          ...m,
          timingCheckpointId: checkpointLinks[m.id] || m.timingCheckpointId,
          visibility: 'public',
          reviewedBy: actorUid,
          reviewedAt: now,
        }));
        validateMarkersForPublish(mergedMarkers, race.checkpoints || []);

        const publicationId = `pub_${raceId}_${distanceId}_v${version.versionNumber}_${Date.now().toString(36)}`;
        const previousPublicationId = bindingSnap.exists ? bindingSnap.data().currentPublicationId : undefined;
        if (previousPublicationId) {
          tx.update(db.doc(`publishedRaceRoutes/${previousPublicationId}`), {
            status: 'superseded',
          });
        }

        const publication = {
          id: publicationId,
          raceId,
          raceName: race.name,
          raceDate: race.date,
          distanceId,
          distanceLabel: distance.label,
          advertisedKm: distance.km,
          measuredDistanceM: version.distanceM,
          elevationGainM: version.elevationGainM,
          elevationLossM: version.elevationLossM,
          presetId,
          versionId,
          versionNumber: version.versionNumber,
          geometryHash: version.geometryHash,
          canonicalGeometry: version.canonicalGeometry,
          elevationProvenance: version.elevationProvenance,
          markers: mergedMarkers,
          chapters: Array.isArray(input.chapters) ? input.chapters : [],
          status: 'published',
          publishedAt: now,
          publishedBy: actorUid,
          reviewedAt: version.reviewedAt || now,
          ...(version.mapLayerProvenance ? { mapLayerProvenance: version.mapLayerProvenance } : {}),
          ...(previousPublicationId ? { supersedesPublicationId: previousPublicationId } : {}),
          ...(raceStarted && input.overrideFreeze ? { overrideReason: String(input.reason).trim() } : {}),
        };

        const binding = {
          id: `${raceId}_${distanceId}`,
          raceId,
          distanceId,
          distanceLabel: distance.label,
          advertisedKm: distance.km,
          presetId,
          versionId,
          versionNumber: version.versionNumber,
          currentPublicationId: publicationId,
          bindingRevision: currentBindingRev + 1,
          checkpointLinks,
          updatedAt: now,
          updatedBy: actorUid,
        };

        const catalogEntry = {
          id: `${raceId}_${distanceId}`,
          raceId,
          raceName: race.name,
          raceDate: race.date,
          region: version.region || 'Philippines',
          distanceId,
          distanceLabel: distance.label,
          advertisedKm: distance.km,
          measuredDistanceM: version.distanceM,
          elevationGainM: version.elevationGainM,
          elevationStatus: version.elevationProvenance?.status || 'unavailable',
          landmarkCount: mergedMarkers.filter((m) => m.kind === 'landmark').length,
          checkpointCount: mergedMarkers.length,
          currentPublicationId: publicationId,
          versionNumber: version.versionNumber,
          status: 'published',
          publishedAt: now,
          ...(version.mapLayerProvenance ? { mapLayerProvenance: version.mapLayerProvenance } : {}),
        };

        tx.set(bindingRef, binding);
        tx.set(db.doc(`publishedRaceRoutes/${publicationId}`), publication);
        tx.set(db.doc(`raceRouteCatalog/${raceId}_${distanceId}`), catalogEntry);
        recordAudit(tx, {
          action: raceStarted && input.overrideFreeze ? 'freeze_override' : 'publish',
          presetId,
          versionId,
          raceId,
          distanceId,
          publicationId,
          previousPublicationId: previousPublicationId || null,
          reason: input.reason || `Published v${version.versionNumber}`,
        });
        tx.create(idempRef, { digest: reqDigest, response: { binding, publication, catalogEntry }, at: now });
        return { binding, publication, catalogEntry };
      });

      await writeStorageAsset(
        `route-published/${pubResult.publication.id}/manifest.json`,
        JSON.stringify(pubResult.publication),
        'application/json',
      );
      if (pubResult.publication.mapLayerProvenance) {
        await writeStorageAsset(
          `route-published/${pubResult.publication.id}/tiles-manifest.json`,
          JSON.stringify(pubResult.publication.mapLayerProvenance),
          'application/json',
        );
      }
      result = pubResult;
    } else if (path === '/withdraw') {
      if (!policy.can(actor, actorAccess, 'routes.publish')) {
        fail('You do not have permission to withdraw a published course.', 403);
      }
      const raceId = assertId(input.raceId, 'race ID');
      const distanceId = assertId(input.distanceId, 'distance ID');
      const publicationId = assertId(input.publicationId, 'publication ID');
      const reason = assertText(input.reason, 300, 'Withdrawal reason');

      await db.runTransaction(async (tx) => {
        const raceSnap = await tx.get(db.doc(`races/${raceId}`));
        if (!raceSnap.exists) fail('Race not found.', 404);
        if (!policy.inScope(actor, actorAccess, { ...raceSnap.data(), id: raceSnap.id })) {
          fail('Race is outside your access scope.', 403);
        }
        const pubRef = db.doc(`publishedRaceRoutes/${publicationId}`);
        const pubSnap = await tx.get(pubRef);
        if (!pubSnap.exists) fail('Publication not found.', 404);
        tx.update(pubRef, { status: 'withdrawn', withdrawalReason: reason });
        tx.update(db.doc(`raceRouteCatalog/${raceId}_${distanceId}`), { status: 'withdrawn' });
        recordAudit(tx, { action: 'withdraw', raceId, distanceId, publicationId, reason });
        tx.create(idempRef, { digest: reqDigest, response: { withdrawn: true, publicationId }, at: now });
      });
      result = { withdrawn: true, publicationId };
    } else if (path === '/rollback') {
      if (!policy.can(actor, actorAccess, 'routes.assign')) {
        fail('You do not have permission to roll back race bindings.', 403);
      }
      const raceId = assertId(input.raceId, 'race ID');
      const distanceId = assertId(input.distanceId, 'distance ID');
      const targetPublicationId = assertId(input.targetPublicationId, 'target publication ID');
      const reason = assertText(input.reason || 'Rolled back to previous reviewed publication', 300, 'Rollback reason');

      const rb = await db.runTransaction(async (tx) => {
        const raceSnap = await tx.get(db.doc(`races/${raceId}`));
        if (!raceSnap.exists) fail('Race not found.', 404);
        if (!policy.inScope(actor, actorAccess, { ...raceSnap.data(), id: raceSnap.id })) {
          fail('Race is outside your access scope.', 403);
        }
        const bindingRef = db.doc(`races/${raceId}/routeBindings/${distanceId}`);
        const targetRef = db.doc(`publishedRaceRoutes/${targetPublicationId}`);
        const [bindingSnap, targetSnap] = await Promise.all([tx.get(bindingRef), tx.get(targetRef)]);
        if (!targetSnap.exists) fail('Target publication not found.', 404);
        const target = targetSnap.data();
        if (target.raceId !== raceId || target.distanceId !== distanceId) {
          fail('Target publication does not belong to this race distance.', 400);
        }
        const prevPubId = bindingSnap.exists ? bindingSnap.data().currentPublicationId : null;
        if (prevPubId && prevPubId !== targetPublicationId) {
          tx.update(db.doc(`publishedRaceRoutes/${prevPubId}`), { status: 'superseded' });
        }
        tx.update(targetRef, { status: 'published' });
        const nextRevision = (bindingSnap.exists ? bindingSnap.data().bindingRevision || 0 : 0) + 1;
        tx.set(bindingRef, {
          ...(bindingSnap.exists ? bindingSnap.data() : {}),
          currentPublicationId: targetPublicationId,
          versionId: target.versionId,
          versionNumber: target.versionNumber,
          bindingRevision: nextRevision,
          updatedAt: now,
          updatedBy: actorUid,
        }, { merge: true });
        tx.set(db.doc(`raceRouteCatalog/${raceId}_${distanceId}`), {
          currentPublicationId: targetPublicationId,
          versionNumber: target.versionNumber,
          status: 'published',
          publishedAt: target.publishedAt,
        }, { merge: true });
        recordAudit(tx, {
          action: 'rollback',
          raceId,
          distanceId,
          publicationId: targetPublicationId,
          previousPublicationId: prevPubId,
          reason,
        });
        tx.create(idempRef, { digest: reqDigest, response: { rolledBackTo: targetPublicationId }, at: now });
        return { rolledBackTo: targetPublicationId };
      });
      result = rb;
    } else if (path === '/archive-preset') {
      if (!policy.can(actor, actorAccess, 'routes.archive')) {
        fail('You do not have permission to archive presets.', 403);
      }
      const presetId = assertId(input.presetId, 'preset ID');
      await db.runTransaction(async (tx) => {
        const ref = db.doc(`routePresets/${presetId}`);
        const snap = await tx.get(ref);
        if (!snap.exists) fail('Preset not found.', 404);
        if (!canEditPreset(actor, actorAccess, snap.data())) fail('Preset is outside your access scope.', 403);
        tx.update(ref, { archived: Boolean(input.archived ?? true), updatedAt: now, updatedBy: actorUid });
        recordAudit(tx, { action: 'archive_preset', presetId, reason: input.archived === false ? 'Restored' : 'Archived' });
        tx.create(idempRef, { digest: reqDigest, response: { archived: Boolean(input.archived ?? true) }, at: now });
      });
      result = { archived: Boolean(input.archived ?? true) };
    } else {
      fail('Unknown route command.', 404);
    }

    return result;
  }

  return { execute };
}

module.exports = { createRouteService, validateMarkersForPublish };
