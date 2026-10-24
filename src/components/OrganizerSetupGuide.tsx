import { ArrowRight, CheckCircle2, ClipboardList, Cpu, Flag, Radio, ShieldCheck, Trophy, Users2, X } from 'lucide-react';

type OrganizerGuideDestination = 'race' | 'myevents' | 'timing' | 'broadcast';

interface OrganizerSetupGuideProps {
  onClose: () => void;
  onNavigate: (destination: OrganizerGuideDestination) => void;
}

const steps: Array<{
  number: string;
  title: string;
  description: string;
  tips: string[];
  destination: OrganizerGuideDestination;
  action: string;
  icon: typeof Flag;
}> = [
  {
    number: '01',
    title: 'Create the race',
    description: 'Open Race Setup, then enter the race name, date, race distances, registration deadline, and Start / Finish checkpoints.',
    tips: ['Add every distance before opening registration.', 'For printable race bibs, upload a blank 1200 × 800 px landscape (3:2) layout; you can use a different bib design for every distance. The PDF prints two full-bleed bibs per A4—set your printer to Borderless, then cut once across the centre.', 'Age categories apply to Solo entries; Duo and Trio use their team category.'],
    destination: 'race',
    action: 'Open Race Setup',
    icon: Flag,
  },
  {
    number: '02',
    title: 'Set registration and payment',
    description: 'Turn Registration status on. For paid races, choose PayMongo when verified, or enable Manual Payment and add your official GCash / QRPh and instructions.',
    tips: ['A manual registration stays Pending until the organizer confirms the payment.', 'Keep the QR code and account details accurate before publishing.'],
    destination: 'race',
    action: 'Edit payment setup',
    icon: ClipboardList,
  },
  {
    number: '03',
    title: 'Add your race team',
    description: 'Inside Race Setup → Organizer Team, the primary organizer can add approved organizer accounts. They can then edit the race, see registrants, assign chips, and operate timing.',
    tips: ['Your teammate must first have an approved Organizer account.', 'Only the primary creator can add or remove team members.'],
    destination: 'race',
    action: 'Manage organizer team',
    icon: Users2,
  },
  {
    number: '04',
    title: 'Review your registrants',
    description: 'Use My Race Events for the event overview. In Live Timing, select the race to add/import runners, verify manual payments, and assign each RFID chip to the correct bib.',
    tips: ['For Assign Chips, use the desktop keyboard scanner for one-at-a-time accurate assignment.', 'Test a few assigned tags before race day.'],
    destination: 'timing',
    action: 'Open Live Timing',
    icon: Cpu,
  },
  {
    number: '05',
    title: 'Run race-day timing',
    description: 'In Live Timing, choose Check-In, Start, or Finish. Select Keyboard Scanner or VF-787P, arm the station, then record scans. Fire the official gun start at the actual start time.',
    tips: ['Check-In is helpful but a Finish scan can still use the gun-start fallback when needed.', 'Keep each scanner station on its correct checkpoint mode.'],
    destination: 'timing',
    action: 'Go to timing station',
    icon: Radio,
  },
  {
    number: '06',
    title: 'Publish and close the race',
    description: 'Review the official ranking, correct any verified timing issue, then mark the race complete. The public results page lets runners search their name or bib and download their certificate.',
    tips: ['Use Live Hub if you want spectators to see a live leaderboard during the race.', 'Only complete the race after the final finishers and corrections are reviewed.'],
    destination: 'broadcast',
    action: 'Open Live Hub',
    icon: Trophy,
  },
];

export default function OrganizerSetupGuide({ onClose, onNavigate }: OrganizerSetupGuideProps) {
  const goTo = (destination: OrganizerGuideDestination) => {
    onNavigate(destination);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/65 backdrop-blur-sm p-0 sm:p-5" role="dialog" aria-modal="true" aria-labelledby="organizer-guide-title">
      <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-t-[28px] sm:rounded-[28px] border border-[var(--border-default)] bg-[var(--surface-page)] shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--border-default)] bg-[var(--surface-page)] px-5 sm:px-7 py-5">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-red-500/25 bg-red-500/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-red-500">
              <ShieldCheck className="h-3.5 w-3.5" /> Organizer guide
            </div>
            <h2 id="organizer-guide-title" className="mt-2 font-display text-xl font-black uppercase tracking-tight text-[var(--text-primary)]">Set up a race from start to finish</h2>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">Follow this checklist before opening registration and again on race day.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close organizer guide" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full glass-inset text-[var(--text-secondary)] transition hover:text-red-500">
            <X className="h-4 w-4" />
          </button>
        </div>

        <ol className="space-y-3 p-5 sm:p-7">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <li key={step.number} className="glass-inset p-4 sm:p-5">
                <div className="flex gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-red-500/10 text-red-500">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[10px] font-black tracking-widest text-red-500">STEP {step.number}</p>
                    <h3 className="mt-0.5 text-sm font-black uppercase tracking-tight text-[var(--text-primary)]">{step.title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{step.description}</p>
                    <ul className="mt-3 space-y-1.5">
                      {step.tips.map((tip) => (
                        <li key={tip} className="flex gap-1.5 text-[10.5px] leading-relaxed text-[var(--text-muted)]">
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" /> {tip}
                        </li>
                      ))}
                    </ul>
                    <button type="button" onClick={() => goTo(step.destination)} className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-red-500 transition hover:text-red-400">
                      {step.action} <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
