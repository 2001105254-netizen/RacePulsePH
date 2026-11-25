import { lazy, Suspense, useState } from 'react';
import { signOutUser } from '../firebase';
import { UserProfile } from '../types';
import { useAccess } from '../lib/access';
import { hasAnyPersonalCapability } from '../lib/runnerShell';
import { usePresenceHeartbeat } from '../lib/telemetry/client';
import type { WorkspaceSwitchProps } from './DesktopSidebar';
import { AnimatedTabView, ViewLoadingSkeleton, type NavDirection } from './ui/MotionPrimitives';

const AdminDashboard = lazy(() => import('./AdminDashboard'));
const RunnerDashboard = lazy(() => import('./RunnerDashboard'));

export default function AuthorizedWorkspace({ profile, raceId, onRaceHandled }: { profile: UserProfile; raceId: string | null; onRaceHandled: () => void }) {
  const access = useAccess();
  const operations = access.authority || ['race.view','race.create','routes.view','bibs.studio','timing.view','roster.view','engraving.view','users.view','hub.manage','hub.publish','highlights.view'].some(access.can);
  const personal = hasAnyPersonalCapability(access.can);
  const [selected, setSelected] = useState<'operations' | 'personal'>(operations ? 'operations' : 'personal');
  const [workspaceDirection, setWorkspaceDirection] = useState<NavDirection>('forward');
  const workspace: 'operations' | 'personal' = selected === 'operations' && operations || !personal ? 'operations' : 'personal';

  usePresenceHeartbeat(profile, workspace, access.ready && !access.suspended && (operations || personal));

  const selectWorkspace = (next: 'operations' | 'personal') => {
    setWorkspaceDirection(next === 'personal' ? 'forward' : 'back');
    setSelected(next);
  };

  if (access.suspended || (!operations && !personal)) {
    return (
      <div className="p-8 text-center space-y-4">
        <p>Your account currently has no active access. Contact a Super Admin.</p>
        <button
          type="button"
          onClick={() => signOutUser()}
          className="min-h-11 px-4 py-2 rounded-xl border border-[var(--border-default)] font-semibold text-sm text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
        >
          Sign out
        </button>
      </div>
    );
  }

  const workspaceSwitch: WorkspaceSwitchProps | undefined =
    operations && personal ? { current: workspace, onSelect: selectWorkspace } : undefined;
  const pendingApprovalNotice = profile.role === 'organizer' && !profile.approved;

  return (
    <AnimatedTabView
      tabKey={`${access.version}:${workspace}`}
      direction={workspaceDirection}
      className="flex-grow flex flex-col min-h-0"
    >
      <Suspense fallback={<ViewLoadingSkeleton label="Loading workspace" />}>
        {workspace === 'operations' ? (
          <AdminDashboard
            profile={profile}
            workspaceSwitch={workspaceSwitch}
            pendingApprovalNotice={pendingApprovalNotice}
          />
        ) : (
          <RunnerDashboard
            profile={profile}
            initialRaceId={raceId}
            onInitialRaceHandled={onRaceHandled}
            workspaceSwitch={workspaceSwitch}
            pendingApprovalNotice={pendingApprovalNotice}
          />
        )}
      </Suspense>
    </AnimatedTabView>
  );
}
