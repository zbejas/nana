import type { ReactNode } from 'react';
import logo from '../../assets/nana.svg';
import { Button } from '../ui';

interface AuthShellProps {
  children: ReactNode;
  footer?: ReactNode;
}

const FACTS: Array<{ label: string; value: string }> = [
  { label: 'Workspace', value: 'Self-hosted' },
  { label: 'Editor', value: 'Markdown' },
  { label: 'Views', value: 'Boards · Timeline' },
  { label: 'AI', value: 'Your provider' },
];

/**
 * The shared frame for sign-in, onboarding, reset, and email confirmation.
 * A ledger-like brand panel on canvas-deep, a form column on canvas, one rule
 * between them. No glow, no gradient.
 */
export function AuthShell({ children, footer }: AuthShellProps) {
  return (
    <div className="min-h-screen overflow-y-auto bg-canvas">
      <div className="mx-auto grid min-h-screen w-full max-w-[1440px] grid-cols-1 lg:grid-cols-12">
        <section className="flex flex-col justify-between bg-canvas-deep px-6 py-10 sm:px-10 lg:col-span-5 lg:min-h-screen lg:border-r lg:border-line lg:px-12 lg:py-14">
          <div className="min-w-0">
            <div className="flex items-center gap-4">
              <img src={logo} alt="" className="h-12 w-12 shrink-0" draggable={false} />
              <div className="min-w-0">
                <h1 className="font-display text-[2.5rem] font-semibold leading-none tracking-[-0.02em] text-ink">
                  Nana
                </h1>
                <p className="mt-1.5 font-mono text-[10px] font-medium uppercase leading-tight tracking-[0.08em] text-ink-muted">
                  Not Another Notes App
                </p>
              </div>
            </div>

            <p className="mt-8 max-w-sm text-sm leading-relaxed text-ink-secondary">
              A quiet place for your writing, your reading, and the work around it. Self-hosted, so the whole desk is
              yours.
            </p>

            <dl className="mt-10 hidden max-w-sm divide-y divide-line border-y border-line lg:block">
              {FACTS.map((fact) => (
                <div key={fact.label} className="flex items-baseline justify-between gap-6 py-2.5">
                  <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-ink-muted">
                    {fact.label}
                  </dt>
                  <dd className="truncate font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
                    {fact.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <p className="mt-10 hidden font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-ink-muted lg:block">
            Your data stays on this server.
          </p>
        </section>

        <section className="flex flex-col justify-center px-4 py-10 sm:px-8 lg:col-span-7 lg:px-16 lg:py-14">
          <div className="mx-auto w-full max-w-md">
            {children}
            {footer ?? (
              <p className="mt-4 text-center font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-ink-muted">
                No third-party account required.
              </p>
            )}
          </div>
        </section>
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

export function AuthCard({ title, description, children }: AuthCardProps) {
  return (
    <div className="rounded-panel border border-line bg-surface p-5 sm:p-6">
      <div className="mb-5">
        <h2 className="font-display text-2xl font-semibold leading-tight tracking-[-0.02em] text-ink">{title}</h2>
        {description && <p className="mt-1.5 max-w-[64ch] text-sm leading-relaxed text-ink-secondary">{description}</p>}
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
