const fs = require('fs');
const policy = require('../functions/access-policy');
let source = fs.readFileSync('scripts/firestore-base.rules', 'utf8').replace(/^\uFEFF/, '').replaceAll('\r\n','\n');
function block(marker, replacement) {
  const start=source.indexOf(marker); if(start<0)throw Error(marker);
  const open=source.indexOf('{',start+marker.length); let depth=1,i=open+1;
  for(;i<source.length && depth;i++){if(source[i]==='{')depth++;else if(source[i]==='}')depth--;}
  source=source.slice(0,start)+replacement+source.slice(i);
}
// Regenerate this bounded helper region whenever presets change.
const markerStart = '    // ACCESS POLICY GENERATED START', markerEnd = '    // ACCESS POLICY GENERATED END';
if(source.includes(markerStart)) source=source.slice(0,source.indexOf(markerStart))+source.slice(source.indexOf(markerEnd)+markerEnd.length);
const presets = Object.fromEntries(policy.roles.map(role=>[role,policy.defaults(role)]));
const literal = value => JSON.stringify(value).replaceAll('"', "'");
const helpers = `${markerStart}
    match /userAccess/{uid} { allow read: if request.auth != null && (request.auth.uid == uid || isSuperAdmin()); allow write: if false; }
    match /accessHistory/{id} { allow read, write: if false; }
    match /accessSystem/{id} { allow read: if isSuperAdmin(); allow write: if false; }
    function accessForCaller(caller) {
      return exists(/databases/$(database)/documents/userAccess/$(request.auth.uid))
        ? get(/databases/$(database)/documents/userAccess/$(request.auth.uid)).data
        : {'status': 'active', 'scope': caller.role in ['admin','superadmin'] ? 'all' : 'owned-assigned', 'raceIds': [], 'overrides': {}};
    }
    function access() {
      return accessForCaller(callerDoc().data);
    }
    function presetForRole(role, action) {
      return role == 'superadmin' || (role == 'admin' && !action.matches('personal[.].*') && action != 'highlights.playlist' && action != 'bibs.studio')
        || (role == 'organizer' && !action.matches('engraving[.].*') && !action.matches('highlights[.].*') && action != 'users.view' && action != 'timing.correct' && action != 'bibs.studio')
        || (role == 'runner' && action.matches('personal[.].*'));
    }
    function preset(action) {
      return presetForRole(callerDoc().data.role, action);
    }
    function directAction(p, o, role, action) {
      return (action in p ? p[action] : (action in o ? o[action] : presetForRole(role, action))) == true;
    }
    function permBase(action, role, approved, p, o) {
      return (role != 'organizer' || approved || action == 'personal.register')
        && (role == 'superadmin' || directAction(p, o, role, action));
    }
    function actionDepsOk(p, o, role, action) {
      return (action in ['highlights.manage','highlights.settings'] ? directAction(p, o, role, 'highlights.view') : true)
        && (action != 'highlights.playlist' || (directAction(p, o, role, 'highlights.view') && directAction(p, o, role, 'highlights.settings')))
        && (action in ['routes.create','routes.edit','routes.media','routes.archive'] ? directAction(p, o, role, 'routes.view') : true)
        && (action != 'routes.publish' || (directAction(p, o, role, 'routes.view') && directAction(p, o, role, 'routes.edit')))
        && (action != 'routes.assign' || (directAction(p, o, role, 'routes.view') && directAction(p, o, role, 'race.view')));
    }
    function callerHasAction(acc, role, action) {
      return directAction(acc.get('permissions', {}), acc.get('overrides', {}), role, action);
    }
    function fallbackPermission(action) {
      return callerHasAction(access(), callerDoc().data.role, action);
    }
    function permissionForCaller(action, caller, acc) {
      let role = caller.role;
      let p = acc.get('permissions', {});
      let o = acc.get('overrides', {});
      return acc.status == 'active'
        && (role != 'organizer' || caller.get('approved', false) == true || action.matches('personal[.].*'))
        && (role == 'superadmin'
          || (directAction(p, o, role, action)
            && (!(action in ['highlights.manage','highlights.settings','highlights.playlist','routes.create','routes.edit','routes.media','routes.publish','routes.assign','routes.archive'])
              || actionDepsOk(p, o, role, action))));
    }
    function permission(action) {
      return request.auth != null && exists(/databases/$(database)/documents/users/$(request.auth.uid))
        && permissionForCaller(action, callerDoc().data, access());
    }
    function raceScopeForCaller(raceId, caller, acc) {
      let race = get(/databases/$(database)/documents/races/$(raceId)).data;
      // Super Admin remains global even if an older userAccess document has
      // an obsolete selected/owned scope.
      return caller.role == 'superadmin' || acc.scope == 'all'
        || (acc.scope == 'selected' && raceId in acc.raceIds)
        || (acc.scope == 'owned-assigned' && (race.createdBy == request.auth.uid || request.auth.uid in race.get('organizerIds', [])));
    }
    function raceScope(raceId) {
      return raceScopeForCaller(raceId, callerDoc().data, access());
    }
    function racePermission(action, raceId) { return permission(action) && raceScope(raceId); }
    function changed(fields) { return request.resource.data.diff(resource.data).affectedKeys().hasAny(fields); }
${markerEnd}`;
source=source.replace('    function isValidId(id)',helpers+'\n\n    function isValidId(id)');
block('function isSuperAdmin()',`function isSuperAdmin() { return request.auth != null && exists(/databases/$(database)/documents/users/$(request.auth.uid)) && callerDoc().data.role == 'superadmin' && access().status == 'active'; }`);
block('function managesRace(raceId)',`function managesRace(raceId) { return racePermission('race.view', raceId); }`);
block('function ownsRecordedSplit(raceId, bibNumber)',`function ownsRecordedSplit(raceId, bibNumber) {
      let directRegistration = exists(/databases/$(database)/documents/runners/$(request.auth.uid + '_' + raceId))
        && get(/databases/$(database)/documents/runners/$(request.auth.uid + '_' + raceId)).data.bibNumber == bibNumber;
      // Imported/Google Form runners can securely link their physical bib to
      // their account through the server-side QR claim flow. The claim stores
      // only the profile needed for their own race screen.
      let bibClaim = exists(/databases/$(database)/documents/runnerClaims/$(request.auth.uid + '_' + raceId))
        && get(/databases/$(database)/documents/runnerClaims/$(request.auth.uid + '_' + raceId)).data.bibNumber == bibNumber;
      return isSignedIn() && (directRegistration || bibClaim);
    }`);
block('match /users/{uid}',`match /users/{uid} {
      allow read: if (request.auth != null && request.auth.uid == uid) || isSuperAdmin() || permission('users.view') || (permission('race.team') && resource.data.role == 'organizer' && resource.data.approved == true);
      allow create: if request.auth != null && request.auth.token.email_verified == true && request.auth.uid == uid
        && !isRemovedAccount(uid) && isValidUserCreate(request.resource.data)
        && request.resource.data.role in ['runner','organizer','superadmin']
        && request.resource.data.uid == uid && request.resource.data.email == request.auth.token.email;
      allow update: if request.auth != null && request.auth.uid == uid
        && !isRemovedAccount(uid)
        && (!exists(/databases/$(database)/documents/userAccess/$(uid)) || get(/databases/$(database)/documents/userAccess/$(uid)).data.get('status', 'active') == 'active')
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['displayName','nickname','photoURL','coverURL','coverPreset','bio','location','runClub','favoriteDistance','socialLink','emergencyContactName','emergencyContactPhone','shirtSize','medicalNotes','username','marketingOptIn','marketingUpdatedAt'])
        && request.resource.data.displayName is string && request.resource.data.displayName.size() >= 1 && request.resource.data.displayName.size() <= 100
        && hasSafeProfileDetails(request.resource.data)
        && (!changed(['username']) || ((!resource.data.keys().hasAny(['username']) || resource.data.username == null || resource.data.username == '') && hasValidUsernameBinding(uid, request.resource.data)));
      allow delete: if request.auth != null && request.auth.uid == uid && resource.data.role != 'superadmin';
    }`);
block('match /removedAccounts/{uid}',`match /removedAccounts/{uid} { allow read: if isSuperAdmin(); allow write: if false; }`);
block('match /races/{raceId}',`match /races/{raceId} {
      allow read: if true;
      allow create: if permission('race.create') && request.resource.data.createdBy == request.auth.uid && request.resource.data.id == raceId
        && request.resource.data.get('createdAt', '') is string
        && (!request.resource.data.keys().hasAny(['livestreamUrl']) || request.resource.data.livestreamUrl == '' || isSafeHttpUrl(request.resource.data.livestreamUrl))
        && (!request.resource.data.keys().hasAny(['routeMapUrl']) || request.resource.data.routeMapUrl == '' || isSafeHttpUrl(request.resource.data.routeMapUrl))
        && (!request.resource.data.keys().hasAny(['routeGpxUrl']) || request.resource.data.routeGpxUrl == '' || isSafeStorageOrHttpsUrl(request.resource.data.routeGpxUrl))
        && !request.resource.data.keys().hasAny(['gunStartTime','waveStartTimes','completedAt'])
        && (!request.resource.data.keys().hasAny(['posterImage','inclusionImage']) || permission('race.artwork'))
        && (!request.resource.data.keys().hasAny(['routeGpxUrl','routeGpxFileName','routeGpxUploadedAt']) || permission('race.artwork'))
        && (!request.resource.data.keys().hasAny(['raceBibTemplateImage','raceBibCustomFont','raceBibLayout','raceBibTemplatesByDistance','raceBibTemplatesByEntryCategory','raceBibShowRaffleNumber','raceBibShowQrCode']) || permission('race.bibs'))
        && (request.resource.data.get('organizerIds', []).size() == 0 || permission('race.team'))
        && (!(request.resource.data.get('onlinePaymentEnabled', false) || request.resource.data.get('manualPaymentEnabled', false)) || permission('payment.configure'));
      allow update: if raceScope(raceId) && request.resource.data.createdBy == resource.data.createdBy && request.resource.data.createdAt == resource.data.createdAt
        && (!changed(['livestreamUrl']) || request.resource.data.get('livestreamUrl', '') == '' || isSafeHttpUrl(request.resource.data.livestreamUrl))
        && (!changed(['routeMapUrl']) || request.resource.data.get('routeMapUrl', '') == '' || isSafeHttpUrl(request.resource.data.routeMapUrl))
        && (!changed(['routeGpxUrl']) || request.resource.data.get('routeGpxUrl', '') == '' || isSafeStorageOrHttpsUrl(request.resource.data.routeGpxUrl))
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['name','date','inclusions','checkpoints','ageCategories','youngestRunnerAwardEnabled','oldestRunnerAwardEnabled','distances','entryCategories','registrationOpen','registrationCloseDate','onlinePaymentEnabled','paymentFeeMode','manualPaymentEnabled','manualPaymentInstructions','manualPaymentQrImage','posterImage','inclusionImage','routeGpxUrl','routeGpxFileName','routeGpxUploadedAt','raceBibTemplateImage','raceBibCustomFont','raceBibLayout','raceBibTemplatesByDistance','raceBibTemplatesByEntryCategory','raceBibShowRaffleNumber','raceBibShowQrCode','organizerIds','gunStartTime','waveStartTimes','completedAt','liveBroadcastEnabled','livestreamUrl','routeMapUrl','finishReviewWindowMs','disqualifiedBibs'])
        && (!changed(['finishReviewWindowMs']) || (permission('timing.correct') && request.resource.data.finishReviewWindowMs is number && request.resource.data.finishReviewWindowMs >= 0 && request.resource.data.finishReviewWindowMs <= 60000))
        && (!changed(['disqualifiedBibs']) || ((permission('timing.correct') || permission('timing.scan')) && request.resource.data.disqualifiedBibs is map && request.resource.data.disqualifiedBibs.size() <= 500))
        && (!changed(['name','date','inclusions']) || permission('race.edit'))
        && (!changed(['checkpoints','ageCategories','youngestRunnerAwardEnabled','oldestRunnerAwardEnabled','entryCategories']) || permission('race.categories'))
        && (!changed(['distances']) || (permission('race.categories') && permission('payment.configure')))
        && (!changed(['registrationOpen','registrationCloseDate']) || permission('race.registration') || (permission('timing.finish') && changed(['completedAt']) && request.resource.data.registrationOpen == false))
        && (!changed(['onlinePaymentEnabled','paymentFeeMode','manualPaymentEnabled','manualPaymentInstructions','manualPaymentQrImage']) || permission('payment.configure'))
        && (!changed(['posterImage','inclusionImage','routeGpxUrl','routeGpxFileName','routeGpxUploadedAt']) || permission('race.artwork'))
        && (!changed(['raceBibTemplateImage','raceBibCustomFont','raceBibLayout','raceBibTemplatesByDistance','raceBibTemplatesByEntryCategory','raceBibShowRaffleNumber','raceBibShowQrCode']) || permission('race.bibs'))
        && (!changed(['organizerIds']) || (permission('race.team') && (resource.data.createdBy == request.auth.uid || isSuperAdmin())))
        && (!changed(['liveBroadcastEnabled']) || permission('hub.publish'))
        && (!changed(['livestreamUrl','routeMapUrl']) || permission('hub.manage'))
        && (!changed(['completedAt']) || (request.resource.data.get('completedAt', null) == null ? permission('timing.reopen') : permission('timing.finish') && getAfter(/databases/$(database)/documents/liveResults/$(raceId)).data.updatedAt == request.resource.data.completedAt))
        && (!changed(['gunStartTime','waveStartTimes']) || permission('timing.reset') || (permission('timing.start') && !resource.data.get('waveStartTimes', {}).diff(request.resource.data.get('waveStartTimes', {})).affectedKeys().hasAny(resource.data.get('waveStartTimes', {}).keys()) && resource.data.get('gunStartTime', null) == null));
      allow delete: if isSuperAdmin() && raceScope(raceId);
    }`);
source=source.replace("return managesRace(resource.data.raceId)\n        && resource.data.paymentStatus", "return racePermission('payment.confirm', resource.data.raceId)\n        && resource.data.paymentStatus");
block('match /runners/{regId}',`match /runners/{regId} {
      allow read: if racePermission('roster.view', resource.data.raceId) || (isSignedIn() && resource.data.uid == request.auth.uid && (permission('personal.register') || permission('personal.results') || permission('personal.bibs') || permission('personal.certificates')));
      allow create: if isValidRunnerProfile(request.resource.data) && hasValidRegistrationId(regId, request.resource.data)
        && (hasNoPaymentMetadata(request.resource.data) || createsManualPaymentReservation(request.resource.data))
        && !request.resource.data.keys().hasAny(['kitClaimedAt','chipId','startsAfterBib'])
        && (racePermission('roster.add', request.resource.data.raceId) || racePermission('roster.import', request.resource.data.raceId) || (request.resource.data.get('isFreeSlot', false) && racePermission('roster.slots', request.resource.data.raceId)) || (permission('personal.register') && request.resource.data.uid == request.auth.uid && !request.resource.data.get('isFreeSlot', false) && selfRegistrationAllowed(request.resource.data)));
      allow update: if isValidRunnerProfile(request.resource.data) && hasValidRegistrationId(regId, request.resource.data)
        && request.resource.data.uid == resource.data.uid && request.resource.data.raceId == resource.data.raceId && request.resource.data.createdAt == resource.data.createdAt
        && (organizerConfirmsManualPayment() || (paymentMetadataUnchanged()
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['fullName','gender','age','ageNotProvided','shirtSize','emergencyContactName','emergencyContactPhone','entryCategory','teamName','teamMembers','distance','bibNumber','chipId','startsAfterBib','kitClaimedAt'])
          && (!changed(['chipId']) || racePermission('roster.chips', resource.data.raceId))
          && (!changed(['bibNumber']) || racePermission('roster.bibs', resource.data.raceId))
          && (!changed(['startsAfterBib']) || racePermission('roster.edit', resource.data.raceId))
          && (!changed(['kitClaimedAt']) || racePermission('roster.kits', resource.data.raceId))
          && (!changed(['fullName','gender','age','ageNotProvided','shirtSize','emergencyContactName','emergencyContactPhone','entryCategory','teamName','teamMembers','distance']) || racePermission('roster.edit', resource.data.raceId) || (permission('personal.register') && resource.data.uid == request.auth.uid && (!changed(['distance','entryCategory']) || resource.data.get('paymentStatus', '') == '')))));
      allow delete: if (isSuperAdmin() && raceScope(resource.data.raceId)) || racePermission('roster.remove', resource.data.raceId) || (permission('personal.register') && resource.data.uid == request.auth.uid && resource.data.get('paymentStatus', '') != 'paid' && !resource.data.keys().hasAny(['chipId','kitClaimedAt']));
    }`);
source=source.replace('    match /bibCounters/{counterId} {',`    // A server-side QR claim lets a Google Form/imported runner attach their
    // own physical bib to their personal account without exposing the roster.
    // Browser clients can read only their own claim and can never forge one.
    match /runnerClaims/{claimId} {
      allow read: if isSignedIn() && resource.data.uid == request.auth.uid
        && (permission('personal.register') || permission('personal.results') || permission('personal.bibs') || permission('personal.certificates'));
      allow write: if false;
    }

    match /bibCounters/{counterId} {`);
block('match /bibCounters/{counterId}',`match /bibCounters/{counterId} {
      allow read: if permission('personal.register') || permission('roster.add') || permission('roster.slots');
      // Counters contain no private data. Only bounded monotonic increments are permitted.
      allow create: if request.resource.data.keys().hasOnly(['count','raceId']) && request.resource.data.raceId is string && counterId.matches(request.resource.data.raceId + '_.*') && request.resource.data.count is int && request.resource.data.count > 0 && exists(/databases/$(database)/documents/races/$(request.resource.data.raceId)) && ((permission('personal.register') && request.resource.data.count <= 20) || ((racePermission('roster.add', request.resource.data.raceId) || racePermission('roster.slots', request.resource.data.raceId)) && request.resource.data.count <= 5000));
      allow update: if request.resource.data.keys().hasOnly(['count','raceId']) && request.resource.data.raceId is string && (!('raceId' in resource.data) || request.resource.data.raceId == resource.data.raceId) && counterId.matches(request.resource.data.raceId + '_.*') && request.resource.data.count is int && request.resource.data.count >= resource.data.count && ((permission('personal.register') && request.resource.data.count <= resource.data.count + 20) || ((racePermission('roster.add', request.resource.data.raceId) || racePermission('roster.slots', request.resource.data.raceId)) && request.resource.data.count <= resource.data.count + 5000));
    }`);
block('match /chipReads/{readId}',`match /chipReads/{readId} {
      allow read: if racePermission('timing.view', resource.data.raceId) || (permission('personal.results') && ownsRecordedSplit(resource.data.raceId, resource.data.bibNumber));
      allow create: if isValidChipRead(request.resource.data) && request.resource.data.recordedBy == request.auth.uid && racePermission('timing.scan', request.resource.data.raceId) && !get(/databases/$(database)/documents/races/$(request.resource.data.raceId)).data.keys().hasAny(['completedAt']);
      allow update: if request.resource.data == resource.data && racePermission('timing.scan', resource.data.raceId);
      allow delete: if (isSuperAdmin() && raceScope(resource.data.raceId)) || racePermission('timing.correct', resource.data.raceId);
    }`);
block('match /liveResults/{raceId}',`match /liveResults/{raceId} {
      allow read: if true;
      allow create, update: if request.resource.data.raceId == raceId && racePermission('results.publish', raceId)
        && (!getAfter(/databases/$(database)/documents/races/$(raceId)).data.keys().hasAny(['completedAt'])
          || (permission('timing.finish') && !get(/databases/$(database)/documents/races/$(raceId)).data.keys().hasAny(['completedAt']) && request.resource.data.updatedAt == getAfter(/databases/$(database)/documents/races/$(raceId)).data.completedAt));
      allow delete: if isSuperAdmin() && raceScope(raceId);
    }`);
source=source.replace('data.keys().size() <= 10', 'data.keys().size() <= 11');
block('match /orders/{orderId}',`match /orders/{orderId} {
      allow read: if permission('engraving.view') || (permission('personal.engraving') && resource.data.get('ownerUid', null) == request.auth.uid);
      allow create: if isValidId(orderId) && isValidOrder(request.resource.data) && request.resource.data.status == 'queued' && (permission('engraving.create') || (permission('personal.engraving') && request.resource.data.ownerUid == request.auth.uid));
      allow update: if isValidOrder(request.resource.data) && permission('engraving.status') && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status','updatedAt']);
      allow delete: if isSuperAdmin() || (permission('personal.engraving') && resource.data.get('ownerUid', null) == request.auth.uid && resource.data.status == 'queued');
    }`);
block('match /runnerHighlights/{highlightId}',`match /runnerHighlights/{highlightId} {
      allow read: if true;
      allow create, update: if isValidId(highlightId) && permission('highlights.manage') && isValidHighlight(request.resource.data);
      allow delete: if isSuperAdmin() || permission('highlights.manage');
    }`);
block('match /system/highlightsConfig',`match /system/highlightsConfig {
      allow read: if true;
      allow create: if permission('highlights.settings')
        && (!request.resource.data.keys().hasAny(['pinPodiumFirst','filterRaceId','hideExpired']) || permission('highlights.playlist'));
      allow update: if permission('highlights.settings')
        && (!changed(['pinPodiumFirst','filterRaceId','hideExpired']) || permission('highlights.playlist'));
      allow delete: if isSuperAdmin();
    }

    function canAccessPresetData(presetData) {
      return isSuperAdmin()
        || (access().scope == 'all' && permission('routes.view'))
        || presetData.ownerUid == request.auth.uid
        || request.auth.uid in presetData.get('editorIds', []);
    }

    function canAccessPreset(presetId) {
      return exists(/databases/$(database)/documents/routePresets/$(presetId))
        && canAccessPresetData(get(/databases/$(database)/documents/routePresets/$(presetId)).data);
    }

    match /routePresets/{presetId} {
      allow read: if permission('routes.view') && canAccessPresetData(resource.data);
      allow create: if isValidId(presetId) && permission('routes.create') && request.resource.data.ownerUid == request.auth.uid;
      allow update: if permission('routes.edit') && canAccessPresetData(resource.data)
        && request.resource.data.ownerUid == resource.data.ownerUid
        && (!changed(['archived']) || permission('routes.archive'));
      allow delete: if isSuperAdmin();

      match /drafts/{draftId} {
        allow read: if permission('routes.view') && canAccessPreset(presetId);
        allow create, update: if isValidId(draftId) && permission('routes.edit') && canAccessPreset(presetId);
        allow delete: if isSuperAdmin();

        match /markers/{markerId} {
          allow read: if permission('routes.view') && canAccessPreset(presetId);
          allow create, update: if isValidId(markerId) && permission('routes.edit') && canAccessPreset(presetId);
          allow delete: if isSuperAdmin() || (permission('routes.edit') && canAccessPreset(presetId));
        }
      }

      match /versions/{versionId} {
        allow read: if permission('routes.view') && canAccessPreset(presetId);
        allow create: if isValidId(versionId) && permission('routes.publish') && canAccessPreset(presetId);
        allow update, delete: if false;
      }
    }

    match /races/{raceId}/routeBindings/{distanceId} {
      allow read: if true;
      allow create, update: if isValidId(distanceId) && racePermission('routes.assign', raceId);
      allow delete: if isSuperAdmin() && raceScope(raceId);
    }

    match /publishedRaceRoutes/{publicationId} {
      allow get, list: if resource.data.get('status', '') == 'published' || permission('routes.view');
      allow create, update: if isValidId(publicationId) && (permission('routes.publish') || permission('routes.assign'));
      allow delete: if isSuperAdmin();
    }

    match /raceRouteCatalog/{entryId} {
      allow read: if true;
      allow create, update: if isValidId(entryId) && (permission('routes.publish') || permission('routes.assign'));
      allow delete: if isSuperAdmin();
    }

    match /routeJobs/{jobId} {
      allow read: if permission('routes.view');
      allow create, update: if isValidId(jobId) && permission('routes.edit');
      allow delete: if isSuperAdmin();
    }

    match /routeAudit/{eventId} {
      allow read: if permission('routes.view');
      allow create: if isValidId(eventId) && (permission('routes.edit') || permission('routes.publish') || permission('routes.assign') || permission('routes.archive'));
      allow update, delete: if false;
    }`);
// Social mutations retain their existing ownership/consent restrictions.
const socialStart=source.indexOf('match /friendRequests/'),socialEnd=source.indexOf('// ========== SYSTEM');
source=source.slice(0,socialStart)+source.slice(socialStart,socialEnd).replaceAll('isSignedIn()',"permission('personal.friends')")+source.slice(socialEnd);
const invitesStart=source.indexOf('match /raceInvites/'),invitesEnd=source.indexOf('// ========== SYSTEM');
source=source.slice(0,invitesStart)+source.slice(invitesStart,invitesEnd).replaceAll("permission('personal.friends')", "permission('personal.invites')")+source.slice(invitesEnd);
// Cache field differences and permission maps once for compound settings writes.
for (const [path,name] of [['races','raceUpdateAllowed'],['runners','runnerUpdateAllowed']]) {
 const begin=source.indexOf(`match /${path}/`),allow=source.indexOf('allow update: if ',begin),end=source.indexOf(';',allow);
 const original=source.slice(allow+'allow update: if '.length,end);
 const expression=original.replaceAll('request.resource.data.diff(resource.data).affectedKeys()', 'fields')
   .replace(/changed\((\[[^\]]*\])\)/g,'fields.hasAny($1)')
   .replace(/racePermission\('([^']+)', resource.data.raceId\)/g,"(permBase('$1', role, approved, p, o) && scoped)")
   .replace(/permission\('([^']+)'\)/g,"permBase('$1', role, approved, p, o)")
   .replace(/raceScope\(([^)]+)\)/g,"raceScopeForCaller($1, caller, acc)")
   .replace(/isSuperAdmin\(\)/g,"(role == 'superadmin')");
 const parameter=path==='races'?'raceId':'regId';
 const helper=`function ${name}(${parameter}) {
      return request.auth != null && exists(/databases/$(database)/documents/users/$(request.auth.uid))
        && ${name}WithCaller(${parameter}, callerDoc().data);
    }
    function ${name}WithCaller(${parameter}, caller) {
      let acc = accessForCaller(caller);
      let role = caller.role;
      let approved = caller.get('approved', false) == true;
      let p = acc.get('permissions', {});
      let o = acc.get('overrides', {});
      let fields = request.resource.data.diff(resource.data).affectedKeys();
      let scoped = ${path==='runners'?'raceScopeForCaller(resource.data.raceId, caller, acc)':'true'};
      return acc.status == 'active' && ${expression};
    }
    `;
 source=source.slice(0,allow)+`allow update: if ${name}(${parameter})`+source.slice(end);
 const match=source.indexOf(`match /${path}/`);source=source.slice(0,match)+helper+source.slice(match);
}
{
 const begin=source.indexOf('match /runners/{regId}'),allow=source.indexOf('allow create: if ',begin),end=source.indexOf(';',allow);
 const original=source.slice(allow+'allow create: if '.length,end);
 const trimmedOriginal=original.replace('isValidRunnerProfile(request.resource.data) && hasValidRegistrationId(regId, request.resource.data)\n        && ','');
 const expression=trimmedOriginal
   .replace(/racePermission\('([^']+)', ([^)]+)\)/g,"(permBase('$1', role, approved, p, o) && scoped)")
   .replace(/permission\('([^']+)'\)/g,"permBase('$1', role, approved, p, o)");
 const helper=`function runnerCreateAllowed(regId) {
      return request.auth != null && exists(/databases/$(database)/documents/users/$(request.auth.uid))
        && isValidRunnerProfile(request.resource.data) && hasValidRegistrationId(regId, request.resource.data)
        && runnerCreateAllowedWithCaller(callerDoc().data);
    }
    function runnerCreateAllowedWithCaller(caller) {
      let acc = accessForCaller(caller);
      let role = caller.role;
      let approved = caller.get('approved', false) == true;
      let p = acc.get('permissions', {});
      let o = acc.get('overrides', {});
      let scoped = raceScopeForCaller(request.resource.data.raceId, caller, acc);
      return acc.status == 'active' && ${expression};
    }
    `;
 source=source.slice(0,allow)+'allow create: if runnerCreateAllowed(regId)'+source.slice(end);
 const match=source.indexOf('match /runners/{regId}');source=source.slice(0,match)+helper+source.slice(match);
}
for (const marker of ['function isAdmin()', 'function isStaff()', 'function isOrganizer()', 'function managesRace(raceId)']) block(marker, '');
fs.writeFileSync('firestore.rules', '// Generated by scripts/build-access-rules.cjs; edit the generator and regenerate.\n'+source.replace(/[ \t]+$/gm,''));
fs.writeFileSync('src/lib/access-presets.json', JSON.stringify({roles:policy.roles,groups:policy.groups,dependencies:policy.dependencies,presets},null,2)+'\n');
