import type { ReactNode } from 'react';
import { PencilSquareIcon, Square3Stack3DIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { Button } from '../ui';

interface AuthShellProps {
  children: ReactNode;
  footer?: ReactNode;
}

const PILLARS = [
  {
    title: 'Write without noise',
    body: 'Markdown, attachments, versions, and a reading surface that stays out of the way.',
    icon: PencilSquareIcon,
  },
  {
    title: 'Keep the work close',
    body: 'Folders for the library, boards for the work, and a clear line between the two.',
    icon: Square3Stack3DIcon,
  },
  {
    title: 'Ask what you already wrote',
    body: 'The assistant reads your own notes and boards, on demand. Nothing is indexed behind your back.',
    icon: SparklesIcon,
  },
];

/**
 * The shared frame for sign-in, onboarding, reset, and email confirmation.
 * A quiet cover on canvas-deep, a form column on canvas. Flat surfaces and one
 * signal accent; no glow, no gradient.
 */
export function AuthShell({ children, footer }: AuthShellProps) {
  return (
    <div className="min-h-screen overflow-y-auto bg-canvas">
      <div className="mx-auto grid min-h-screen w-full max-w-[1500px] grid-cols-1 lg:grid-cols-12">
        <section className="relative flex flex-col justify-between overflow-hidden bg-cover px-6 py-10 text-cover-ink sm:px-10 lg:col-span-6 lg:min-h-screen lg:border-r lg:border-cover-line lg:px-14 lg:py-14">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-[7px] bg-cover-ink text-[16px] font-semibold lowercase leading-none text-cover" aria-hidden="true">
                n
              </span>
              <div className="min-w-0">
                <h1 className="text-[15px] font-semibold leading-none tracking-[-0.02em] text-cover-ink">
                  Nana
                </h1>
                <p className="mt-1.5 text-[11.5px] font-medium leading-tight text-cover-muted">
                  Not another notes app
                </p>
              </div>
            </div>

            <h2 className="mt-12 max-w-[12ch] text-[2.4rem] font-semibold leading-[1.02] tracking-[-0.035em] text-cover-ink sm:text-[3rem]">
              A quieter place to think.
            </h2>
            <p className="mt-5 max-w-sm text-[14px] leading-relaxed text-cover-muted">
              Your writing, your reading, and the work around it. Self-hosted, so the whole desk is yours.
            </p>

            <div className="mt-10 hidden max-w-sm border-t border-cover-line lg:block">
              {PILLARS.map((pillar) => {
                const Icon = pillar.icon;
                return (
                  <div
                    key={pillar.title}
                    className="flex gap-3 border-b border-cover-line py-3.5"
                  >
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-cover-line text-cover-muted">
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-medium text-cover-ink">{pillar.title}</span>
                      <span className="mt-0.5 block text-[12px] leading-relaxed text-cover-muted">
                        {pillar.body}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-10 flex items-center gap-2 text-[11.5px] font-medium text-cover-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
            Self-hosted. Your data stays on this server.
          </div>
        </section>

        <section className="flex flex-col justify-center px-4 py-10 sm:px-8 lg:col-span-6 lg:px-16 lg:py-14">
          <div className="mx-auto w-full max-w-[26rem]">
            {children}
            {footer ?? (
              <p className="mt-5 text-center text-[11.5px] text-ink-muted">
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
    <div className="rounded-panel border border-line bg-surface p-6 sm:p-7">
      <div className="mb-6">
        <h2 className="text-[24px] font-semibold leading-tight tracking-[-0.025em] text-ink">{title}</h2>
        {description && <p className="mt-2 max-w-[62ch] text-[13.5px] leading-relaxed text-ink-secondary">{description}</p>}
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
