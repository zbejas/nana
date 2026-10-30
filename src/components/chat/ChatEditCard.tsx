import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowTopRightOnSquareIcon,
  ArrowUturnLeftIcon,
  DocumentTextIcon,
  FolderIcon,
  ListBulletIcon,
  ViewColumnsIcon,
} from '@heroicons/react/24/outline';
import { Button } from '../ui';
import { NanaMark } from './NanaMark';
import type { ChatUiEdit } from '../../lib/chat/types';

interface ChatEditCardProps {
  edit: ChatUiEdit;
  onUndo: (id: string) => void;
}

const STATUS_LABEL: Record<ChatUiEdit['status'], string> = {
  applying: 'Applying',
  applied: 'Applied',
  undone: 'Undone',
  failed: 'Failed',
  conflict: 'Conflict',
};

const STATUS_CLASS: Record<ChatUiEdit['status'], string> = {
  applying: 'border-signal/25 bg-signal-soft text-signal',
  applied: 'border-success/25 bg-success-soft text-success',
  undone: 'border-line bg-surface-sunken text-ink-muted',
  failed: 'border-danger/25 bg-danger-soft text-danger',
  conflict: 'border-warning/25 bg-warning-soft text-warning',
};

function TargetIcon({ type }: { type: ChatUiEdit['target']['type'] }) {
  if (type === 'board') return <ViewColumnsIcon className="h-4 w-4" aria-hidden="true" />;
  if (type === 'task') return <ListBulletIcon className="h-4 w-4" aria-hidden="true" />;
  return <DocumentTextIcon className="h-4 w-4" aria-hidden="true" />;
}

function openLabel(edit: ChatUiEdit): string {
  if (edit.target.type === 'board') return 'Open board';
  if (edit.target.type === 'task') return 'Open task';
  return 'Open note';
}

function withSection(url: string, section: string | undefined): string {
  if (!url || !section) return url;
  const [base, hash] = url.split('#');
  const [pathname, query = ''] = (base ?? '').split('?');
  const params = new URLSearchParams(query);
  params.set('nanaSection', section);
  const next = `${pathname}?${params.toString()}`;
  return hash ? `${next}#${hash}` : next;
}

function sectionLabel(heading: string | null, path: string[]): string {
  if (path.length > 0) return path.join(' > ');
  if (heading) return heading;
  return 'Section';
}

/** One direct, reversible write made by the assistant. */
export function ChatEditCard({ edit, onUndo }: ChatEditCardProps) {
  const [now, setNow] = useState(() => Date.now());
  const created = Date.parse(edit.created);
  const deadline = Number.isFinite(created) ? created + 10_000 : 0;
  const showCountdown = edit.status === 'applied' && deadline > now;
  const remaining = showCountdown ? Math.max(1, Math.ceil((deadline - now) / 1000)) : 0;

  useEffect(() => {
    if (edit.status !== 'applied' || !Number.isFinite(created) || deadline <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [edit.status, created, deadline]);

  const sections = edit.changed.sections ?? [];
  const fields = edit.changed.fields ?? [];
  const firstSection = sections[0]
    ? sectionLabel(sections[0].heading, sections[0].path)
    : undefined;
  const href = edit.target.type === 'document'
    ? withSection(edit.target.url, firstSection)
    : edit.target.url;

  return (
    <div className="mt-3 overflow-hidden rounded-panel border border-line bg-surface">
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <NanaMark size={18} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium text-ink">
              <TargetIcon type={edit.target.type} />
              <span className="max-w-[13rem] truncate" title={edit.target.title}>
                {edit.target.title}
              </span>
            </span>
            <span
              className={`inline-flex h-5 items-center gap-1 rounded-[4px] border px-1.5 text-[10.5px] font-medium ${STATUS_CLASS[edit.status]}`}
            >
              {edit.status === 'applying' && (
                <span className="h-1 w-1 animate-pulse rounded-full bg-current" aria-hidden="true" />
              )}
              {STATUS_LABEL[edit.status]}
            </span>
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-secondary">{edit.summary}</p>
        </div>
      </div>

      {(sections.length > 0 || fields.length > 0) && (
        <div className="border-t border-line bg-surface-sunken/60 px-3 py-2">
          <p className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-ink-muted">
            {sections.length > 0 ? 'Changed sections' : 'Changed fields'}
          </p>
          <ul className="mt-1 space-y-0.5">
            {sections.map((section, index) => (
              <li
                key={`${section.heading ?? 'section'}:${index}`}
                className="flex items-center gap-1.5 text-[11.5px] text-ink-secondary"
              >
                <span className="h-1 w-1 rounded-full bg-signal/70" aria-hidden="true" />
                <span className="truncate">{sectionLabel(section.heading, section.path)}</span>
              </li>
            ))}
            {fields.map((field) => (
              <li key={field} className="flex items-center gap-1.5 text-[11.5px] text-ink-secondary">
                <span className="h-1 w-1 rounded-full bg-signal/70" aria-hidden="true" />
                <span className="truncate">{field}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(edit.status === 'failed' || edit.status === 'conflict') && (
        <p className="border-t border-line px-3 py-2 text-[11.5px] leading-relaxed text-ink-muted">
          {edit.status === 'conflict'
            ? 'The record changed while Nana was editing. Re-read it and ask again.'
            : 'Nana could not apply this change.'}
        </p>
      )}

      {edit.undoError && (
        <p className="border-t border-line px-3 py-2 text-[11.5px] text-danger">{edit.undoError}</p>
      )}

      <div className="flex items-center gap-1.5 border-t border-line px-2.5 py-1.5">
        {href ? (
          <Link
            to={href}
            className="inline-flex h-7 items-center gap-1.5 rounded-control px-2 text-[11.5px] font-medium text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {openLabel(edit)}
          </Link>
        ) : (
          <span className="inline-flex h-7 items-center gap-1.5 px-2 text-[11.5px] text-ink-muted">
            <FolderIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {openLabel(edit)}
          </span>
        )}

        {edit.status === 'applied' && edit.undo.available && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 px-2 text-[11.5px]"
            icon={<ArrowUturnLeftIcon />}
            loading={edit.undoing}
            onClick={() => onUndo(edit.id)}
          >
            {showCountdown ? `Undo · ${remaining}s` : 'Undo'}
          </Button>
        )}
      </div>
    </div>
  );
}
