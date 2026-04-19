import { Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import logo from "../assets/nana.svg";
import { AuthForm } from "../components/AuthForm";
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
      check();
    }
  }, [loading, checkHasUsers]);

  if (loading || checking) {
    return (
      <div className="max-w-7xl mx-auto p-8 text-center">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  // Redirect to onboarding if no users exist
  if (hasUsers === false) {
    return <Navigate to="/onboarding" replace />;
  }

  if (user) {
    return <Navigate to={getDefaultHomepageRoute()} replace />;
  }

  return (
    <div className="min-h-screen overflow-y-auto flex items-center justify-center px-4 py-6 sm:px-8 sm:py-10">
      <div className="w-full max-w-md text-center relative z-10">
        <div className="flex justify-center items-center mb-4 sm:mb-6 md:mb-8">
          <img
            src={logo}
            alt="Nana Logo"
            className="h-24 sm:h-32 md:h-40 p-3 sm:p-5 md:p-6 transition-all duration-300 hover:drop-shadow-[0_0_2em_#646cffaa]"
          />
        </div>
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold my-2 sm:my-3 md:my-4 leading-tight">Nana</h1>
        <p className="text-gray-400 mb-4 sm:mb-6 md:mb-8">
          Not Another Notes App
        </p>
        <AuthForm />
      </div>
    </div>
  );
}
