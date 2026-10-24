import type { ReactNode } from 'react';
import logo from '../../assets/nana.svg';
import { Button } from '../ui';

interface AuthShellProps {
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * The shared frame for sign-in, onboarding, reset, and email confirmation.
 * One brand panel, one card column, no drift between auth screens.
 */
export function AuthShell({ children, footer }: AuthShellProps) {
  return (
    <div className="relative min-h-screen overflow-y-auto">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col items-center justify-center px-4 py-10 sm:px-8 lg:flex-row lg:gap-16">
        <div className="relative mb-8 flex max-w-md flex-1 flex-col items-center text-center lg:mb-0 lg:items-start lg:text-left">
          <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-ember-soft blur-3xl" aria-hidden="true" />
          <img
            src={logo}
            alt="Nana"
            className="relative h-24 w-24 drop-shadow-[0_18px_30px_rgba(0,0,0,0.35)] sm:h-32 sm:w-32"
          />
          <h1 className="relative mt-5 font-display text-4xl leading-none tracking-tight text-ink sm:text-5xl">Nana</h1>
          <p className="relative mt-2 font-display text-lg italic text-ink-secondary">Not Another Notes App</p>
          <p className="relative mt-5 max-w-sm text-sm leading-relaxed text-ink-secondary">
            A quiet place for your writing, your reading, and the work around it. Self-hosted, so the whole desk is
            yours.
          </p>
          <div className="relative mt-6 hidden flex-wrap gap-2 lg:flex">
            {['Markdown notes', 'Kanban board', 'Private sharing', 'Your own AI'].map((label) => (
              <span key={label} className="rounded-full border border-line bg-surface/60 px-2.5 py-1 text-[11px] text-ink-secondary">
                {label}
              </span>
            ))}
          </div>
        </div>

        <div className="relative w-full max-w-md flex-1">
          {children}
          {footer ?? (
            <p className="mt-4 text-center text-[11px] text-ink-muted">
              Your data stays on this server. No third-party account required.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

interface AuthCardProps {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}

export function AuthCard({ eyebrow, title, description, children }: AuthCardProps) {
  return (
    <div className="rounded-panel border border-line bg-surface p-5 panel-hairline shadow-panel sm:p-6">
      <div className="mb-5">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 className="mt-2 font-display text-2xl leading-tight text-ink">{title}</h2>
        {description && <p className="mt-1.5 text-sm leading-relaxed text-ink-secondary">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export function AuthBackLink({ onClick, label = 'Back to sign in' }: { onClick: () => void; label?: string }) {
  return (
    <Button variant="ghost" className="w-full" onClick={onClick}>
      {label}
    </Button>
  );
}
