import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowTopRightOnSquareIcon,
  ArrowUturnLeftIcon,
  ChevronDownIcon,
  DocumentTextIcon,
  FolderIcon,
  ListBulletIcon,
  ViewColumnsIcon,
} from '@heroicons/react/24/outline';
import { Button } from '../ui';
import type { ChatUiEdit } from '../../lib/chat/types';

interface ChatEditCardProps {
  edit: ChatUiEdit;
  onUndo: (id: string) => void;
  onConfirm?: (id: string) => void;
  onCancel?: (id: string) => void;
}

const STATUS_LABEL: Record<ChatUiEdit['status'], string> = {
  applying: 'Applying',
  pending: 'Needs confirmation',
  applied: 'Applied',
  undone: 'Undone',
  cancelled: 'Cancelled',
  failed: 'Failed',
  conflict: 'Conflict',
};

const STATUS_CLASS: Record<ChatUiEdit['status'], string> = {
  applying: 'border-signal/25 bg-signal-soft text-signal',
  pending: 'border-warning/25 bg-warning-soft text-warning',
  applied: 'border-success/25 bg-success-soft text-success',
  undone: 'border-line bg-surface-sunken text-ink-muted',
  cancelled: 'border-line bg-surface-sunken text-ink-muted',
  failed: 'border-danger/25 bg-danger-soft text-danger',
  conflict: 'border-warning/25 bg-warning-soft text-warning',
};

function TargetIcon({ type }: { type: ChatUiEdit['target']['type'] }) {
  if (type === 'board') return <ViewColumnsIcon className="h-4 w-4" aria-hidden="true" />;
  if (type === 'task') return <ListBulletIcon className="h-4 w-4" aria-hidden="true" />;
  if (type === 'folder') return <FolderIcon className="h-4 w-4" aria-hidden="true" />;
  return <DocumentTextIcon className="h-4 w-4" aria-hidden="true" />;
}

function openLabel(edit: ChatUiEdit): string {
  if (edit.target.type === 'board') return 'Open board';
  if (edit.target.type === 'task') return 'Open task';
  if (edit.target.type === 'folder') return 'Open folder';
  return 'Open note';
}

function confirmLabel(edit: ChatUiEdit): string {
  if (edit.tool === 'delete_note') return 'Move note to trash';
  if (edit.tool === 'delete_folder') return 'Move folder to trash';
  if (edit.tool === 'delete_task') return 'Delete task';
  if (edit.tool === 'delete_board') return 'Delete board';
  return 'Confirm delete';
}

function cancelLabel(edit: ChatUiEdit): string {
  if (edit.target.type === 'folder') return 'Keep folder';
  if (edit.target.type === 'task') return 'Keep task';
  if (edit.target.type === 'board') return 'Keep board';
  return 'Keep note';
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

/** One applied write or one destructive action, rendered inside the tool disclosure. */
export function ChatEditCard({ edit, onUndo, onConfirm, onCancel }: ChatEditCardProps) {
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(
    edit.status === 'pending' || edit.status === 'failed' || edit.status === 'conflict',
  );
  const created = Date.parse(edit.created);
  const deadline = Number.isFinite(created) ? created + 10_000 : 0;
  const isPending = edit.status === 'pending';
  const showCountdown = edit.status === 'applied' && deadline > now;
  const remaining = showCountdown ? Math.max(1, Math.ceil((deadline - now) / 1000)) : 0;

  useEffect(() => {
    if (edit.status === 'pending' || edit.status === 'failed' || edit.status === 'conflict') {
      setExpanded(true);
    }
  }, [edit.status]);

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
  const dotClass = edit.status === 'pending' || edit.status === 'applying'
    ? 'bg-warning'
    : edit.status === 'failed' || edit.status === 'conflict'
      ? 'bg-danger'
      : edit.status === 'applied'
        ? 'bg-success'
        : 'bg-ink-muted';

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-label={expanded ? 'Hide change details' : 'Show change details'}
        className="flex w-full min-w-0 items-center gap-2 rounded-[4px] px-1.5 py-1 text-left transition-colors hover:bg-surface-sunken/60"
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
        <span className="shrink-0 text-ink-muted [&>svg]:h-3.5 [&>svg]:w-3.5">
          <TargetIcon type={edit.target.type} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-secondary">
          <span className="font-medium text-ink-secondary">{edit.target.title}</span>
          <span className="text-ink-muted"> · {edit.summary}</span>
        </span>
        <span
          className={`inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-[4px] border px-1.5 text-[10.5px] font-medium ${STATUS_CLASS[edit.status]}`}
        >
          {edit.status === 'applying' && (
            <span className="h-1 w-1 animate-pulse rounded-full bg-current" aria-hidden="true" />
          )}
          {STATUS_LABEL[edit.status]}
        </span>
        <ChevronDownIcon
          className={`h-3.5 w-3.5 shrink-0 text-ink-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {expanded && (
        <div className="ml-4 border-l border-line pb-1.5 pl-2.5">
          <p className="py-1 text-[11.5px] leading-relaxed text-ink-secondary">{edit.summary}</p>
          {isPending && (
            <p className="pb-1 text-[11px] leading-relaxed text-ink-muted">
              Nothing changes until you confirm.
            </p>
          )}

          {(sections.length > 0 || fields.length > 0) && (
            <div className="border-t border-line py-1.5">
              <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-ink-muted">
                {sections.length > 0 ? 'Changed sections' : 'Changed fields'}
              </p>
              <ul className="mt-0.5 space-y-0.5">
                {sections.map((section, index) => (
                  <li
                    key={`${section.heading ?? 'section'}:${index}`}
                    className="flex items-center gap-1.5 text-[11px] text-ink-secondary"
                  >
                    <span className="h-1 w-1 rounded-full bg-signal/70" aria-hidden="true" />
                    <span className="truncate">{sectionLabel(section.heading, section.path)}</span>
                  </li>
                ))}
                {fields.map((field) => (
                  <li key={field} className="flex items-center gap-1.5 text-[11px] text-ink-secondary">
                    <span className="h-1 w-1 rounded-full bg-signal/70" aria-hidden="true" />
                    <span className="truncate">{field}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(edit.status === 'failed' || edit.status === 'conflict') && (
            <p className="border-t border-line py-1.5 text-[11px] leading-relaxed text-ink-muted">
              {edit.status === 'conflict'
                ? 'The record changed while Nana was editing. Re-read it and ask again.'
                : 'Nana could not apply this change.'}
            </p>
          )}

          {edit.undoError && (
            <p className="border-t border-line py-1.5 text-[11px] text-danger">{edit.undoError}</p>
          )}

          <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-1.5">
            {href ? (
              <Link
                to={href}
                className="inline-flex h-7 items-center gap-1.5 rounded-control px-1.5 text-[11px] font-medium text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink"
              >
                <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {openLabel(edit)}
              </Link>
            ) : (
              <span className="inline-flex h-7 items-center gap-1.5 px-1.5 text-[11px] text-ink-muted">
                <FolderIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {openLabel(edit)}
              </span>
            )}

            {isPending && (
              <div className="ml-auto flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  disabled={edit.undoing}
                  onClick={() => onCancel?.(edit.id)}
                >
                  {cancelLabel(edit)}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  loading={edit.undoing}
                  onClick={() => onConfirm?.(edit.id)}
                >
                  {confirmLabel(edit)}
                </Button>
              </div>
            )}

            {!isPending && edit.status === 'applied' && edit.undo.available && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 px-2 text-[11px]"
                icon={<ArrowUturnLeftIcon />}
                loading={edit.undoing}
                onClick={() => onUndo(edit.id)}
              >
                {showCountdown ? `Undo · ${remaining}s` : 'Undo'}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
