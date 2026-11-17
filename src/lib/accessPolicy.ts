import catalog from './access-presets.json';

export const roles = catalog.roles;
export const roleLabel = (role: string) =>
  role === 'superadmin' ? 'Super Admin' : role.charAt(0).toUpperCase() + role.slice(1);
export const groups = catalog.groups;
export const dependencies = catalog.dependencies as Record<string, string[]>;

export interface PermissionInfo {
  group: string;
  title: string;
  description: string;
}

export interface PermissionDomain {
  id: string;
  label: string;
  groups: string[];
}

export const permissionDomains: PermissionDomain[] = [
  { id: 'all', label: 'All capabilities', groups: Object.keys(groups) },
  { id: 'events-routes', label: 'Events & Routes', groups: ['Events', 'Routes'] },
  { id: 'race-day', label: 'Roster & Timing', groups: ['Roster', 'Payments', 'Timing', 'Results'] },
  { id: 'studio-media', label: 'Highlights & Engraving', groups: ['Highlights', 'Engraving'] },
  { id: 'runner-dir', label: 'Personal & Directories', groups: ['Personal', 'Directories'] },
];

export const roleDescriptions: Record<string, string> = {
  superadmin: 'Platform oversight, access management, Bib Studio, and all operational and personal tools.',
  admin: 'Day-to-day race operations, Event Data Viewer, Route Studio, timing, engraving, highlights, and reports.',
  organizer: 'Manage owned and assigned events, Route Studio courses, registration desks, and timing.',
  runner: 'Personal registrations, race results, course viewer, digital bibs, certificates, and friends.',
};

export const groupDescriptions: Record<string, string> = {
  Events: 'Set up race events, analytics viewer, categories, artwork, bibs, and organizer teams.',
  Routes: 'Author GPS/GPX courses, elevation intelligence, landmark photos, and published race maps.',
  Roster: 'Manage participant registrations, timing chips, bibs, relay links, and race-day desks.',
  Payments: 'Inspect payment records and revenue analytics, configure checkout fees, and confirm manual transfers.',
  Timing: 'Record checkpoint scans, live finish rankings, start waves, and race-day timing corrections.',
  Results: 'Publish live results, manage Live Hub streams, export reports, and run standalone Bib Studio.',
  Engraving: 'Operate the global medal engraving queue, LightBurn exports, and queue backups.',
  Highlights: 'Publish Podium Pulse cards, configure Marquee Control Deck, and manage smart playlist rules.',
  Personal: "Features for this person's own runner participation, course maps, and friends network.",
  Directories: 'View signed-in organizer and runner directories.',
};

export const permissionCatalog: Record<string, PermissionInfo> = {
  'race.view': {
    group: 'Events',
    title: 'View private operational races',
    description: 'Open My Events directory and race operational dashboards for scoped events.',
  },
  'race.analytics': {
    group: 'Events',
    title: 'Open Event Data Viewer and Portfolio analytics',
    description: 'Inspect Performance, Demographics, and Operations analytics tabs and Portfolio comparisons.',
  },
  'race.create': {
    group: 'Events',
    title: 'Create race events',
    description: 'Create new race events. New races automatically belong to the creator.',
  },
  'race.edit': {
    group: 'Events',
    title: 'Edit event details',
    description: 'Update event name, race date, and listed race inclusions.',
  },
  'race.categories': {
    group: 'Events',
    title: 'Edit distances, checkpoints, and age groups',
    description: 'Configure distances, checkpoints, Solo/Duo/Trio/Group entry formats, age brackets, and Youngest/Oldest Solo awards.',
  },
  'race.registration': {
    group: 'Events',
    title: 'Manage registration status and QR',
    description: 'Open or close registration, set closing dates, and share registration QR codes.',
  },
  'race.artwork': {
    group: 'Events',
    title: 'Upload posters, inclusions, and legacy GPX',
    description: 'Upload event posters, kit inclusion photos, and legacy GPX route files.',
  },
  'race.bibs': {
    group: 'Events',
    title: 'Design event bibs and fonts',
    description: 'Configure event bib templates, text/QR layout positions, and custom bib fonts.',
  },
  'race.team': {
    group: 'Events',
    title: 'Assign organizer team',
    description: 'Add or remove collaborating organizers on owned race events.',
  },
  'routes.view': {
    group: 'Routes',
    title: 'Open Route Studio',
    description: 'View course presets, drafts, DEM elevation intelligence, and route audit logs.',
  },
  'routes.create': {
    group: 'Routes',
    title: 'Create and duplicate course presets',
    description: 'Create new route presets and duplicate existing course variants.',
  },
  'routes.edit': {
    group: 'Routes',
    title: 'Edit course geometry and markers',
    description: 'Draw/erase trails, import GPX routes, tag surfaces, record GPS surveys, and link checkpoint markers.',
  },
  'routes.media': {
    group: 'Routes',
    title: 'Upload landmark photos',
    description: 'Attach EXIF-stripped landmark photos to course markers.',
  },
  'routes.publish': {
    group: 'Routes',
    title: 'Publish and withdraw race routes',
    description: 'Freeze reviewed versions, publish or withdraw public Explorer routes, and apply race-day freeze overrides.',
  },
  'routes.assign': {
    group: 'Routes',
    title: 'Bind courses to race distances',
    description: 'Attach published Route Studio versions to race distances and roll back bindings.',
  },
  'routes.archive': {
    group: 'Routes',
    title: 'Archive and restore course presets',
    description: 'Archive unused route presets or restore archived presets to active drafts.',
  },
  'roster.view': {
    group: 'Roster',
    title: 'View race roster',
    description: 'Read runner registrations, entry categories, and participant lists.',
  },
  'roster.add': {
    group: 'Roster',
    title: 'Add individual runners',
    description: 'Manually register a runner or team entry from the race-day desk.',
  },
  'roster.import': {
    group: 'Roster',
    title: 'Import roster spreadsheets',
    description: 'Bulk import participants from Excel or CSV files.',
  },
  'roster.edit': {
    group: 'Roster',
    title: 'Edit runner details and relay links',
    description: 'Update registration fields, distance, category, and linked consecutive entry bibs.',
  },
  'roster.chips': {
    group: 'Roster',
    title: 'Assign RFID timing chips',
    description: 'Pair or unassign physical timing chip tags to runner bibs.',
  },
  'roster.bibs': {
    group: 'Roster',
    title: 'Change bib numbers',
    description: 'Reassign bib numbers for existing race registrations.',
  },
  'roster.kits': {
    group: 'Roster',
    title: 'Record race kit claims',
    description: 'Mark race kits and bibs as claimed or unclaimed at check-in.',
  },
  'roster.slots': {
    group: 'Roster',
    title: 'Create on-site blank slots',
    description: 'Generate anonymous on-site runner slots with reserved bib numbers.',
  },
  'roster.remove': {
    group: 'Roster',
    title: 'Remove runner registrations',
    description: 'Delete unpaid or test registrations from a race roster.',
  },
  'revenue.view': {
    group: 'Payments',
    title: 'View revenue analytics and payment list',
    description: 'View collected totals, Financial analytics in Event Data Viewer, and read-only Timing Payments records.',
  },
  'payment.configure': {
    group: 'Payments',
    title: 'Configure payment methods and fee policy',
    description: 'Enable PayMongo or manual QR checkout, set distance prices, and choose absorbed vs passed-on fees.',
  },
  'payment.confirm': {
    group: 'Payments',
    title: 'Confirm manual payments',
    description: 'Approve pending cash, GCash, or bank-transfer references in Timing Console Payments.',
  },
  'timing.view': {
    group: 'Timing',
    title: 'View checkpoint timing and Live Rankings',
    description: 'Open Timing Console feeds, Live Rankings broadcast screen, missing-scan flags, and Start Roll Call.',
  },
  'timing.scan': {
    group: 'Timing',
    title: 'Record RFID and QR checkpoint scans',
    description: 'Log checkpoint crossings, sync offline scans, and flag DQs during open races.',
  },
  'timing.manual': {
    group: 'Timing',
    title: 'Enter manual keyboard times',
    description: 'Key in bib numbers and checkpoint times manually at timing desks.',
  },
  'timing.correct': {
    group: 'Timing',
    title: 'Correct, undo, and DQ timing reads',
    description: 'Delete or restore reads, set finish review uncertainty windows, and manage DQs anytime.',
  },
  'timing.start': {
    group: 'Timing',
    title: 'Start race waves',
    description: 'Trigger gun start and distance wave start timestamps.',
  },
  'timing.reset': {
    group: 'Timing',
    title: 'Edit or reset start times',
    description: 'Adjust or clear already-recorded gun and wave start timestamps.',
  },
  'timing.finish': {
    group: 'Timing',
    title: 'Finish race and lock results',
    description: 'Finalize event timing, close registration, and lock official standings.',
  },
  'timing.reopen': {
    group: 'Timing',
    title: 'Reopen finished races',
    description: 'Unlock completed races to resume timing scans or corrections.',
  },
  'results.view': {
    group: 'Results',
    title: 'View computed race results',
    description: 'Inspect calculated rankings, splits, and category placements before publishing.',
  },
  'results.publish': {
    group: 'Results',
    title: 'Publish live results feed',
    description: 'Push live leaderboard standings and splits to public race pages.',
  },
  'results.export': {
    group: 'Results',
    title: 'Export results and performance reports',
    description: 'Download official race results spreadsheets and Performance analytics CSVs.',
  },
  'hub.manage': {
    group: 'Results',
    title: 'Configure Live Hub stream and map links',
    description: 'Set livestream video embeds and external route map links on Live Hub.',
  },
  'hub.publish': {
    group: 'Results',
    title: 'Toggle public Live Hub visibility',
    description: 'Show or hide the public Live Race Hub broadcast page for an event.',
  },
  'roster.export': {
    group: 'Results',
    title: 'Export runner roster and portfolio reports',
    description: 'Download participant roster PDF/CSV sheets and Data Viewer portfolio CSVs.',
  },
  'bibs.export': {
    group: 'Results',
    title: 'Export event race bib PDFs',
    description: 'Generate and download personalized or blank bib PDF sheets for a configured event.',
  },
  'bibs.studio': {
    group: 'Results',
    title: 'Use standalone Bib Studio',
    description: 'Open Bib Studio to import standalone client rosters, design print layouts, and export bib PDFs.',
  },
  'engraving.view': {
    group: 'Engraving',
    title: 'View global engraving queue',
    description: 'Open the Engraving operator console and read all incoming medal orders.',
  },
  'engraving.create': {
    group: 'Engraving',
    title: 'Submit operator engraving orders',
    description: 'Create engraving queue entries on behalf of finishers from the operator desk.',
  },
  'engraving.status': {
    group: 'Engraving',
    title: 'Update engraving job status',
    description: 'Advance medal orders between queued, in-progress, ready, and completed.',
  },
  'engraving.export': {
    group: 'Engraving',
    title: 'Export LightBurn and receipt sheets',
    description: 'Download SVG/CSV engraving layouts and thermal finisher receipts.',
  },
  'engraving.backup': {
    group: 'Engraving',
    title: 'Import and export queue backups',
    description: 'Download or restore JSON snapshots of the local engraving queue.',
  },
  'highlights.view': {
    group: 'Highlights',
    title: 'Open Highlights Studio',
    description: 'Browse published Podium Pulse highlight cards and marquee configuration.',
  },
  'highlights.manage': {
    group: 'Highlights',
    title: 'Create, edit, and delete highlight cards',
    description: 'Publish Podium Pulse solo, duo, and group cards, use Smart Crop, and edit career dossiers.',
  },
  'highlights.settings': {
    group: 'Highlights',
    title: 'Configure Marquee Control Deck physics',
    description: 'Adjust landing reel velocity, hover slowdown, direction, layout mode, and edge fade.',
  },
  'highlights.playlist': {
    group: 'Highlights',
    title: 'Edit smart playlist rules',
    description: 'Control podium-first pinning, race filtering, and expiry hiding on the landing reel.',
  },
  'personal.register': {
    group: 'Personal',
    title: 'Register for race events',
    description: 'Join events, update own unpaid registration details, and cancel unpaid entries.',
  },
  'personal.checkout': {
    group: 'Personal',
    title: 'Start online payment checkout',
    description: 'Initiate PayMongo checkout sessions for personal race registrations.',
  },
  'personal.results': {
    group: 'Personal',
    title: 'View own race results and splits',
    description: 'Access personal finish times, rankings, checkpoint splits, and claimed bib results.',
  },
  'personal.bibs': {
    group: 'Personal',
    title: 'View and download own race bib',
    description: 'Open personal digital race bibs, event check-in QR codes, and published course viewers.',
  },
  'personal.certificates': {
    group: 'Personal',
    title: 'Download finisher certificates',
    description: 'Generate and download personal finisher certificates for completed races.',
  },
  'personal.engraving': {
    group: 'Personal',
    title: 'Request own medal engraving',
    description: 'Submit, view, and cancel personal medal engraving orders.',
  },
  'personal.friends': {
    group: 'Personal',
    title: 'Use runner friends directory',
    description: 'Search runners by username and send, accept, or remove friend requests.',
  },
  'personal.invites': {
    group: 'Personal',
    title: 'Send and receive race invitations',
    description: 'Invite accepted friends to upcoming events and open received race invites.',
  },
  'users.view': {
    group: 'Directories',
    title: 'View organizer and runner directories',
    description: 'Open the Organizers and Runners directory tabs and inspect account rosters.',
  },
};

const inverseDependencies: Record<string, string[]> = {};
for (const [action, deps] of Object.entries(dependencies)) {
  for (const dep of deps) {
    if (!inverseDependencies[dep]) inverseDependencies[dep] = [];
    inverseDependencies[dep].push(action);
  }
}

export const allPermissionKeys = Object.values(groups).flat();

export const permissionTitle = (key: string) => permissionCatalog[key]?.title || key;

export const permissionDescription = (key: string) => permissionCatalog[key]?.description || '';

export const permissionLabel = (key: string) => {
  const entry = permissionCatalog[key];
  return entry ? `${entry.group}: ${entry.title}` : key;
};

export const permissionGroup = (key: string): string => permissionCatalog[key]?.group || '';

export const permissionDependencies = (key: string): string[] => dependencies[key] || [];

export const permissionDependents = (key: string): string[] => inverseDependencies[key] || [];

export function defaults(role: string): Record<string, boolean> {
  return { ...(catalog.presets[role as keyof typeof catalog.presets] || {}) };
}
