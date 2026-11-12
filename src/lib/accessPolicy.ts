import catalog from './access-presets.json';
export const roles = catalog.roles;
export const roleLabel = (role: string) => role === 'superadmin' ? 'Super Admin' : role.charAt(0).toUpperCase() + role.slice(1);
export const groups = catalog.groups;
export const dependencies = catalog.dependencies;
const words: Record<string,string> = { race:'Race', roster:'Runner roster', timing:'Timing', personal:'My participation', hub:'Live Hub', users:'User directory', bibs:'Race bibs', revenue:'Revenue', results:'Results', payment:'Payments', engraving:'Engraving', view:'View', create:'Create', edit:'Edit', categories:'Categories and checkpoints', registration:'Registration settings', artwork:'Artwork', team:'Manage team', add:'Add runners', import:'Import roster', chips:'Assign chips', kits:'Record kit claims', slots:'Create on-site slots', remove:'Remove registrations', configure:'Configure', confirm:'Confirm manual payments', scan:'Record scans', manual:'Manual entry', correct:'Undo reads', start:'Start waves', reset:'Correct/reset start times', finish:'Finish race', reopen:'Reopen race', publish:'Publish', export:'Download reports', manage:'Manage settings', backup:'Import/export backup', register:'Register for events', checkout:'Start payment checkout', certificates:'Download certificates', friends:'Friends', invites:'Race invitations', status:'Update queue status' };
export const permissionLabel = (key: string) => key.split('.').map(part => words[part] || part).join(' — ');
export function defaults(role: string): Record<string, boolean> {
  return { ...(catalog.presets[role] || {}) };
}
