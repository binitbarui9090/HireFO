import { useEffect, type ReactNode } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { Callout, LoadingBlock } from './components/ui/Primitives';
import { Toaster } from './components/ui/Toaster';
import { InvitePage } from './features/auth/InvitePage';
import { LoginPage } from './features/auth/LoginPage';
import { RegisterPage } from './features/auth/RegisterPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { EvaluationPage } from './features/evaluation/EvaluationPage';
import { InterviewCreatePage } from './features/interviews/InterviewCreatePage';
import { InterviewDetailPage } from './features/interviews/InterviewDetailPage';
import { InterviewListPage } from './features/interviews/InterviewListPage';
import { QuestionEditorPage } from './features/questions/QuestionEditorPage';
import { QuestionLibraryPage } from './features/questions/QuestionLibraryPage';
import { AuditPage } from './features/settings/AuditPage';
import { TeamPage } from './features/settings/TeamPage';
import { UsagePage } from './features/settings/UsagePage';
import { WorkspacePage } from './features/workspace/WorkspacePage';
import { useAuthStore, useIsStaff } from './store/auth';
import { useCapabilitiesStore } from './store/capabilities';

function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();

  if (status === 'loading') return <LoadingBlock label="Restoring your session…" />;
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

/** Guards interviewer/admin-only routes; candidates are sent back to their list. */
function RequireStaff({ children }: { children: ReactNode }) {
  const isStaff = useIsStaff();
  if (!isStaff) return <Navigate to="/interviews" replace />;
  return <>{children}</>;
}

function RedirectIfSignedIn({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  if (status === 'loading') return <LoadingBlock label="Loading…" />;
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function NotFound() {
  return (
    <Callout tone="neutral" title="Page not found">
      That page does not exist. Use the navigation on the left to get back on track.
    </Callout>
  );
}

export function App() {
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const loadCapabilities = useCapabilitiesStore((s) => s.load);
  const capabilitiesError = useCapabilitiesStore((s) => s.error);

  useEffect(() => {
    void loadCapabilities();
    void bootstrap();
  }, [bootstrap, loadCapabilities]);

  return (
    <BrowserRouter>
      {capabilitiesError && (
        <div style={{ padding: 'var(--space-4)' }}>
          <Callout tone="danger" title="Backend unreachable">
            {capabilitiesError}
          </Callout>
        </div>
      )}
      <Routes>
        <Route
          path="/login"
          element={
            <RedirectIfSignedIn>
              <LoginPage />
            </RedirectIfSignedIn>
          }
        />
        <Route
          path="/register"
          element={
            <RedirectIfSignedIn>
              <RegisterPage />
            </RedirectIfSignedIn>
          }
        />
        {/* Invitations are reachable while signed in too: the link may be for a
            different organization than the one currently active. */}
        <Route path="/invite/:token" element={<InvitePage />} />

        {/* The workspace is full-bleed and deliberately outside the app shell. */}
        <Route
          path="/interviews/:id/workspace"
          element={
            <RequireAuth>
              <WorkspacePage />
            </RequireAuth>
          }
        />

        <Route
          path="/"
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="interviews" element={<InterviewListPage />} />
          <Route
            path="interviews/new"
            element={
              <RequireStaff>
                <InterviewCreatePage />
              </RequireStaff>
            }
          />
          <Route path="interviews/:id" element={<InterviewDetailPage />} />
          <Route
            path="interviews/:id/evaluation"
            element={
              <RequireStaff>
                <EvaluationPage />
              </RequireStaff>
            }
          />
          <Route
            path="questions"
            element={
              <RequireStaff>
                <QuestionLibraryPage />
              </RequireStaff>
            }
          />
          <Route
            path="questions/new"
            element={
              <RequireStaff>
                <QuestionEditorPage />
              </RequireStaff>
            }
          />
          <Route
            path="questions/:id"
            element={
              <RequireStaff>
                <QuestionEditorPage />
              </RequireStaff>
            }
          />
          <Route
            path="settings/team"
            element={
              <RequireStaff>
                <TeamPage />
              </RequireStaff>
            }
          />
          <Route
            path="settings/usage"
            element={
              <RequireStaff>
                <UsagePage />
              </RequireStaff>
            }
          />
          <Route
            path="settings/audit"
            element={
              <RequireStaff>
                <AuditPage />
              </RequireStaff>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}
