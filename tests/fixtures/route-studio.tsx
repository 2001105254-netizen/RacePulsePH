import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import RouteStudioPanel from '../../src/components/routes/RouteStudioPanel';
import FeedbackProvider from '../../src/components/ui/FeedbackProvider';
import { AccessContext } from '../../src/lib/access';
import { DEMO_BAGUIO_RACE, ensureDemoCoursesSeeded } from '../../src/lib/routes/routeStore';
import type { UserProfile } from '../../src/types';

const params = new URLSearchParams(window.location.search);
const theme = params.get('theme') === 'light' ? 'light' : 'dark';
const emptyRaces = params.get('emptyRaces') === '1';
const seedDemo = params.get('seedDemo') === '1';
document.documentElement.classList.toggle('dark', theme === 'dark');

if (seedDemo && !emptyRaces) {
  void ensureDemoCoursesSeeded(true);
}

const fixtureProfile: UserProfile = {
  uid: 'demo-organizer',
  email: 'director@racepulseph.test',
  displayName: 'Fixture Race Director',
  role: 'admin',
  approved: true,
  createdAt: '2026-10-01T00:00:00Z',
};

const accessValue = {
  can: () => true,
  inScope: () => true,
  authority: false,
  ready: true,
  suspended: false,
  state: { status: 'active', scope: 'all', raceIds: [], overrides: {} },
  version: 'fixture-v1',
};

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <FeedbackProvider>
      <AccessContext.Provider value={accessValue}>
        <main
          id="main-content"
          className="min-h-screen bg-[var(--surface-page)] px-4 py-6 text-[var(--text-primary)] sm:px-6"
        >
          <div className="mx-auto max-w-[1440px]">
            <RouteStudioPanel
              profile={fixtureProfile}
              theme={theme}
              racesOverride={emptyRaces ? [] : [DEMO_BAGUIO_RACE]}
              onNavigateUrl={(url) => {
                window.location.assign(url);
              }}
            />
          </div>
        </main>
      </AccessContext.Provider>
    </FeedbackProvider>
  </React.StrictMode>,
);
