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
    function access() {
      return exists(/databases/$(database)/documents/userAccess/$(request.auth.uid))
        ? get(/databases/$(database)/documents/userAccess/$(request.auth.uid)).data
        : {'status': 'active', 'scope': callerDoc().data.role in ['admin','superadmin'] ? 'all' : 'owned-assigned', 'raceIds': [], 'overrides': {}};
    }
    function preset(action) {
      let role = callerDoc().data.role;
      return role == 'superadmin' || (role == 'admin' && !action.matches('personal[.].*'))
        || (role == 'organizer' && !action.matches('engraving[.].*') && action != 'users.view' && action != 'timing.correct')
        || (role == 'runner' && action.matches('personal[.].*'));
    }
    function rawPermission(action) { return access().get('overrides', {}).get(action, preset(action)) == true; }
    function permission(action) {
      return request.auth != null && exists(/databases/$(database)/documents/users/$(request.auth.uid))
        && exists(/databases/$(database)/documents/userAccess/$(request.auth.uid))
        && access().status == 'active' && access().get('permissions', {}).get(action, false) == true;
    }
    function raceScope(raceId) {
      let race = get(/databases/$(database)/documents/races/$(raceId)).data;
      return access().scope == 'all'
        || (access().scope == 'selected' && raceId in access().raceIds)
        || (access().scope == 'owned-assigned' && (race.createdBy == request.auth.uid || request.auth.uid in race.get('organizerIds', [])));
    }
    function racePermission(action, raceId) { return permission(action) && raceScope(raceId); }
    function changed(fields) { return request.resource.data.diff(resource.data).affectedKeys().hasAny(fields); }
${markerEnd}`;
source=source.replace('    function isValidId(id)',helpers+'\n\n    function isValidId(id)');
block('function isSuperAdmin()',`function isSuperAdmin() { return request.auth != null && exists(/databases/$(database)/documents/users/$(request.auth.uid)) && callerDoc().data.role == 'superadmin' && access().status == 'active'; }`);
block('function managesRace(raceId)',`function managesRace(raceId) { return racePermission('race.view', raceId); }`);
block('match /users/{uid}',`match /users/{uid} {
      allow read: if (request.auth != null && request.auth.uid == uid) || isSuperAdmin() || permission('users.view') || (permission('race.team') && resource.data.role == 'organizer' && resource.data.approved == true);
      allow create: if request.auth != null && request.auth.token.email_verified == true && request.auth.uid == uid
        && !isRemovedAccount(uid) && isValidUserCreate(request.resource.data)
        && request.resource.data.role in ['runner','organizer','superadmin']
        && request.resource.data.uid == uid && request.resource.data.email == request.auth.token.email;
      allow update: if request.auth != null && request.auth.uid == uid
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['displayName','nickname','photoURL','emergencyContactName','emergencyContactPhone','shirtSize','medicalNotes','username'])
        && request.resource.data.displayName is string && request.resource.data.displayName.size() >= 1 && request.resource.data.displayName.size() <= 100
        && hasSafeProfileDetails(request.resource.data) && hasValidUsernameBinding(uid, request.resource.data);
      allow delete: if request.auth != null && request.auth.uid == uid && resource.data.role != 'superadmin';
    }`);
block('match /removedAccounts/{uid}',`match /removedAccounts/{uid} { allow read: if isSuperAdmin(); allow write: if false; }`);
block('match /races/{raceId}',`match /races/{raceId} {
      allow read: if true;
      allow create: if permission('race.create') && request.resource.data.createdBy == request.auth.uid && request.resource.data.id == raceId
        && !request.resource.data.keys().hasAny(['gunStartTime','waveStartTimes','completedAt'])
        && (!request.resource.data.keys().hasAny(['posterImage','inclusionImage']) || permission('race.artwork'))
        && (!request.resource.data.keys().hasAny(['raceBibTemplateImage','raceBibCustomFont','raceBibLayout','raceBibTemplatesByDistance']) || permission('race.bibs'))
        && (request.resource.data.get('organizerIds', []).size() == 0 || permission('race.team'))
        && (!(request.resource.data.get('onlinePaymentEnabled', false) || request.resource.data.get('manualPaymentEnabled', false)) || permission('payment.configure'));
      allow update: if raceScope(raceId) && request.resource.data.createdBy == resource.data.createdBy && request.resource.data.createdAt == resource.data.createdAt
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['name','date','inclusions','checkpoints','ageCategories','distances','entryCategories','registrationOpen','registrationCloseDate','onlinePaymentEnabled','paymentFeeMode','manualPaymentEnabled','manualPaymentInstructions','manualPaymentQrImage','posterImage','inclusionImage','raceBibTemplateImage','raceBibCustomFont','raceBibLayout','raceBibTemplatesByDistance','organizerIds','gunStartTime','waveStartTimes','completedAt','liveBroadcastEnabled','livestreamUrl','routeMapUrl','finishReviewWindowMs'])
        && (!changed(['finishReviewWindowMs']) || (permission('timing.correct') && request.resource.data.finishReviewWindowMs is number && request.resource.data.finishReviewWindowMs >= 0 && request.resource.data.finishReviewWindowMs <= 60000))
        && (!changed(['name','date','inclusions']) || permission('race.edit'))
        && (!changed(['checkpoints','ageCategories','entryCategories']) || permission('race.categories'))
        && (!changed(['distances']) || (permission('race.categories') && permission('payment.configure')))
        && (!changed(['registrationOpen','registrationCloseDate']) || permission('race.registration') || (permission('timing.finish') && changed(['completedAt']) && request.resource.data.registrationOpen == false))
        && (!changed(['onlinePaymentEnabled','paymentFeeMode','manualPaymentEnabled','manualPaymentInstructions','manualPaymentQrImage']) || permission('payment.configure'))
        && (!changed(['posterImage','inclusionImage']) || permission('race.artwork'))
        && (!changed(['raceBibTemplateImage','raceBibCustomFont','raceBibLayout','raceBibTemplatesByDistance']) || permission('race.bibs'))
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
        && (racePermission('roster.add', request.resource.data.raceId) || racePermission('roster.import', request.resource.data.raceId) || (request.resource.data.get('isFreeSlot', false) && racePermission('roster.slots', request.resource.data.raceId)) || (permission('personal.register') && request.resource.data.uid == request.auth.uid && !request.resource.data.get('isFreeSlot', false) && get(/databases/$(database)/documents/races/$(request.resource.data.raceId)).data.get('registrationOpen', true)));
      allow update: if isValidRunnerProfile(request.resource.data) && hasValidRegistrationId(regId, request.resource.data)
        && request.resource.data.uid == resource.data.uid && request.resource.data.raceId == resource.data.raceId && request.resource.data.createdAt == resource.data.createdAt
        && (organizerConfirmsManualPayment() || (paymentMetadataUnchanged()
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['fullName','gender','age','ageNotProvided','shirtSize','emergencyContactName','emergencyContactPhone','entryCategory','teamName','teamMembers','distance','bibNumber','chipId','startsAfterBib','kitClaimedAt'])
          && (!changed(['chipId']) || racePermission('roster.chips', resource.data.raceId))
          && (!changed(['bibNumber']) || racePermission('roster.bibs', resource.data.raceId))
          && (!changed(['startsAfterBib']) || racePermission('roster.edit', resource.data.raceId))
          && (!changed(['kitClaimedAt']) || racePermission('roster.kits', resource.data.raceId))
          && (!changed(['fullName','gender','age','ageNotProvided','shirtSize','emergencyContactName','emergencyContactPhone','entryCategory','teamName','teamMembers','distance']) || racePermission('roster.edit', resource.data.raceId) || (permission('personal.register') && resource.data.uid == request.auth.uid))));
      allow delete: if (isSuperAdmin() && raceScope(resource.data.raceId)) || racePermission('roster.remove', resource.data.raceId) || (permission('personal.register') && resource.data.uid == request.auth.uid);
    }`);
block('match /bibCounters/{counterId}',`match /bibCounters/{counterId} {
      allow read: if permission('personal.register') || permission('roster.add') || permission('roster.slots');
      // Counters contain no private data. Only monotonic increments are permitted.
      allow create: if (permission('personal.register') || racePermission('roster.add', request.resource.data.raceId) || racePermission('roster.slots', request.resource.data.raceId)) && request.resource.data.keys().hasOnly(['count','raceId']) && request.resource.data.raceId is string && counterId.matches(request.resource.data.raceId + '_.*') && request.resource.data.count is int && request.resource.data.count > 0;
      allow update: if (permission('personal.register') || racePermission('roster.add', request.resource.data.raceId) || racePermission('roster.slots', request.resource.data.raceId)) && request.resource.data.keys().hasOnly(['count','raceId']) && request.resource.data.raceId is string && counterId.matches(request.resource.data.raceId + '_.*') && request.resource.data.count is int && request.resource.data.count >= resource.data.count && request.resource.data.count <= resource.data.count + 1000;
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
   .replace(/racePermission\('([^']+)', resource.data.raceId\)/g,"(p.get('$1', false) && scoped)")
   .replace(/permission\('([^']+)'\)/g,"p.get('$1', false)");
 const parameter=path==='races'?'raceId':'regId';
 const helper=`function ${name}(${parameter}) {\n      let p = access().get('permissions', {});\n      let fields = request.resource.data.diff(resource.data).affectedKeys();\n      let scoped = ${path==='runners'?'raceScope(resource.data.raceId)':'true'};\n      return request.auth != null && access().status == 'active' && ${expression};\n    }\n    `;
 source=source.slice(0,allow)+`allow update: if ${name}(${parameter})`+source.slice(end);
 const match=source.indexOf(`match /${path}/`);source=source.slice(0,match)+helper+source.slice(match);
}
for (const marker of ['function isAdmin()', 'function isStaff()', 'function isOrganizer()', 'function managesRace(raceId)']) block(marker, '');
fs.writeFileSync('firestore.rules', '// Generated by scripts/build-access-rules.cjs; edit the generator and regenerate.\n'+source.replace(/[ \t]+$/gm,''));
fs.writeFileSync('src/lib/access-presets.json', JSON.stringify({roles:policy.roles,groups:policy.groups,dependencies:policy.dependencies,presets},null,2)+'\n');
