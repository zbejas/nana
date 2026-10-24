import { Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { AuthForm } from "../components/AuthForm";
import { AuthShell } from "../components/auth/AuthShell";
import { useAuth } from "../lib/auth";
import { getDefaultHomepageRoute } from "../lib/settings";
import { createLogger } from "../lib/logger";

const log = createLogger('SignIn');

export function SignInPage() {
  const { user, loading, hasUsers, checkHasUsers } = useAuth();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const check = async () => {
      try {
        await checkHasUsers();
      } catch (error) {
        log.error('Failed to check users, assuming users exist', error);
      } finally {
        setChecking(false);
      }
    };

    if (!loading) {
      void check();
    }
  }, [loading, checkHasUsers]);

  if (loading || checking) {
    return (
      <div className="flex h-screen items-center justify-center">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-ember" />
      </div>
    );
  }

  if (hasUsers === false) {
    return <Navigate to="/onboarding" replace />;
  }

  if (user) {
    return <Navigate to={getDefaultHomepageRoute()} replace />;
  }

  return (
    <AuthShell>
      <AuthForm />
    </AuthShell>
  );
}
