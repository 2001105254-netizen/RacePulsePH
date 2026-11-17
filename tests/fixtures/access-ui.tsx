import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import FeedbackProvider, { useFeedback } from '../../src/components/ui/FeedbackProvider';
import AccessWorkspace from '../../src/components/AccessWorkspace';
import { AccessDraft, draftKey } from '../../src/lib/accessDraft';
import { Select } from '../../src/components/ui/Select';

const initial: AccessDraft = {
  role: 'admin',
  approved: true,
  scope: 'all',
  raceIds: [],
  overrides: {},
  status: 'active',
};

function Fixture() {
  const [draft, setDraft] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [open, setOpen] = useState(true);
  const { confirm, notify } = useFeedback();
  const dirty = draftKey(draft) !== draftKey(baseline);

  return (
    <>
      <div style={{ padding: 24, maxWidth: 1440, margin: '0 auto' }}>
        <section className="access-directory">
          <div className="access-directory-heading">
            <div>
              <h2>People and access</h2>
              <p>Synthetic fixture for responsive directory and editor verification.</p>
            </div>
            <span className="access-directory-total">1 person</span>
          </div>
          <div className="access-directory-summary" role="group" aria-label="Quick directory filters">
            <button type="button" className="access-summary-chip is-active" aria-pressed="true">
              <span>All people</span>
              <strong>1</strong>
            </button>
            <button type="button" className="access-summary-chip" aria-pressed="false">
              <span>Admins</span>
              <strong>1</strong>
            </button>
            <button type="button" className="access-summary-chip" aria-pressed="false">
              <span>Custom overrides</span>
              <strong>0</strong>
            </button>
          </div>
          <div className="access-directory-toolbar">
            <div className="access-search-wrap">
              <label className="access-search">
                <input
                  aria-label="Search users"
                  placeholder="Search by name, username, or email…"
                  readOnly
                  value=""
                />
              </label>
            </div>
            <div className="access-field access-role-filter">
              <label htmlFor="fixture-people-filter" className="sr-only">
                Filter people
              </label>
              <Select
                id="fixture-people-filter"
                aria-label="Filter people"
                value="all"
                onChange={() => {}}
                surface="card"
                size="lg"
                options={[{ value: 'all', label: 'All people' }]}
              />
            </div>
          </div>
          <div className="access-directory-columns" aria-hidden="true">
            <span>Person</span>
            <span>Role and permissions</span>
            <span>Race access</span>
            <span>Status</span>
            <span />
          </div>
          <ul className="access-user-list">
            <li className="access-user-row">
              <div className="access-user-person">
                <span className="access-avatar" aria-hidden="true">
                  A
                </span>
                <div>
                  <h3>Alexandra Race Organizer</h3>
                  <p>alexandra.long.email@example.test</p>
                </div>
              </div>
              <div className="access-user-role">
                <strong>Admin</strong>
                <span>Preset permissions</span>
              </div>
              <p className="access-user-scope">All races</p>
              <div className="access-user-status-cell">
                <span className="access-status is-active">Active</span>
              </div>
              <button
                type="button"
                className="rp-button rp-button-secondary"
                onClick={() => setOpen(true)}
              >
                Manage access
              </button>
            </li>
          </ul>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
            <button
              type="button"
              className="rp-button rp-button-primary"
              onClick={() => setOpen(true)}
            >
              Open editor
            </button>
            <button
              type="button"
              className="rp-button rp-button-secondary"
              onClick={() =>
                notify({
                  title: 'Could not save access',
                  message: 'Please try again. Your changes are still available.',
                  tone: 'error',
                })
              }
            >
              Show error notification
            </button>
          </div>
        </section>
      </div>
      {open && (
        <AccessWorkspace
          user={{
            uid: 'fixture-user',
            displayName: 'Alexandra Race Organizer',
            email: 'alexandra.long.email@example.test',
            role: 'admin',
            approved: true,
            createdAt: '2026-10-01',
          }}
          currentUserUid="fixture-superadmin"
          draft={draft}
          baseline={baseline}
          races={[
            {
              id: 'race-one',
              name: 'RacePulse City Marathon and Community Run',
              date: '2026-12-05',
            },
            { id: 'race-two', name: 'Mountain Trail Challenge', date: '2026-12-12' },
          ]}
          history={[
            {
              id: 'history-one',
              at: '2026-10-28T08:00:00Z',
              actorUid: 'fixture-admin',
              actorName: 'Sample Super Admin',
              before: {
                role: 'organizer',
                approved: true,
                access: { status: 'active', scope: 'owned-assigned', raceIds: [], overrides: {} },
              },
              after: {
                role: 'admin',
                approved: true,
                access: {
                  status: 'active',
                  scope: 'all',
                  raceIds: [],
                  overrides: { 'highlights.playlist': true },
                },
              },
            },
          ]}
          ready
          loaded
          dirty={dirty}
          busy={false}
          error=""
          conflicted={false}
          historyBusy={false}
          historyLoaded
          onChange={setDraft}
          onClose={async () => {
            if (
              !dirty ||
              (await confirm({
                title: 'Discard unsaved access changes?',
                message:
                  'Your edits have not been saved. Discard them to return to the user directory.',
                confirmLabel: 'Discard changes',
                cancelLabel: 'Keep editing',
                destructive: true,
              }))
            ) {
              setDraft(baseline);
              setOpen(false);
            }
          }}
          onSave={async () => {
            setBaseline(draft);
            setOpen(false);
            notify({
              title: 'Access updated',
              message: 'Alexandra’s access changes have been saved.',
              tone: 'success',
            });
          }}
          onLoadHistory={async () => {}}
          onRestore={async () => {
            setOpen(false);
            notify({ title: 'Configuration restored', tone: 'success' });
          }}
          onRemove={async () => {
            setBaseline({ ...baseline, status: 'suspended' });
            setDraft({ ...draft, status: 'suspended' });
            setOpen(false);
            notify({
              title: 'App access removed',
              message: 'Alexandra no longer has active app access.',
              tone: 'success',
            });
          }}
        />
      )}
    </>
  );
}

const params = new URLSearchParams(location.search);
if (params.get('theme') === 'light') document.documentElement.classList.remove('dark');
if (params.has('width')) {
  const frame = document.createElement('iframe');
  frame.title = 'Responsive access fixture';
  frame.src = `access-ui.html?theme=${params.get('theme') || 'dark'}`;
  frame.style.cssText = `width:${Number(params.get('width'))}px;height:${Number(
    params.get('height') || 844,
  )}px;border:1px solid #777;display:block;margin:10px;`;
  document.body.append(frame);
} else {
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <FeedbackProvider>
        <Fixture />
      </FeedbackProvider>
    </React.StrictMode>,
  );
}
