import { useEffect, useRef, useState } from 'react';
import {
  ChevronDownIcon,
  DocumentTextIcon,
  FolderIcon,
  ListBulletIcon,
  ViewColumnsIcon,
} from '@heroicons/react/24/outline';
import { ChatEditCard } from './ChatEditCard';
import type { ChatUiEdit, ChatUiTool } from '../../lib/chat/types';

interface ChatToolStripProps {
  tools: ChatUiTool[];
  edits?: ChatUiEdit[];
  streaming?: boolean;
  onUndoEdit?: (id: string) => void;
  onConfirmDelete?: (id: string) => void;
  onCancelDelete?: (id: string) => void;
}

interface ToolMeta {
  verb: string;
  noun: 'note' | 'board' | 'task' | 'folder';
  running: string;
}

const TOOL_META: Record<string, ToolMeta> = {
  list_folders: { verb: 'Checked', noun: 'folder', running: 'Checking your folders…' },
  list_notes: { verb: 'Searched', noun: 'note', running: 'Searching your notes…' },
  read_note: { verb: 'Read', noun: 'note', running: 'Reading a note…' },
  list_boards: { verb: 'Checked', noun: 'board', running: 'Checking your boards…' },
  read_board: { verb: 'Read', noun: 'board', running: 'Reading a board…' },
  create_folder: { verb: 'Created', noun: 'folder', running: 'Creating a folder…' },
  rename_folder: { verb: 'Renamed', noun: 'folder', running: 'Renaming a folder…' },
  move_folder: { verb: 'Moved', noun: 'folder', running: 'Moving a folder…' },
  create_note: { verb: 'Created', noun: 'note', running: 'Creating a note…' },
  edit_note: { verb: 'Edited', noun: 'note', running: 'Editing a note…' },
  update_note: { verb: 'Edited', noun: 'note', running: 'Editing a note…' },
  move_note: { verb: 'Moved', noun: 'note', running: 'Moving a note…' },
  append_note: { verb: 'Edited', noun: 'note', running: 'Editing a note…' },
  create_board: { verb: 'Created', noun: 'board', running: 'Creating a board…' },
  update_board: { verb: 'Edited', noun: 'board', running: 'Updating a board…' },
  move_board: { verb: 'Moved', noun: 'board', running: 'Moving a board…' },
  create_task: { verb: 'Created', noun: 'task', running: 'Adding a task…' },
  update_task: { verb: 'Updated', noun: 'task', running: 'Updating a task…' },
  move_task: { verb: 'Moved', noun: 'task', running: 'Moving a task…' },
  delete_note: { verb: 'Prepared delete', noun: 'note', running: 'Preparing delete confirmation…' },
  delete_task: { verb: 'Prepared delete', noun: 'task', running: 'Preparing delete confirmation…' },
  delete_folder: { verb: 'Prepared delete', noun: 'folder', running: 'Preparing delete confirmation…' },
  delete_board: { verb: 'Prepared delete', noun: 'board', running: 'Preparing delete confirmation…' },
};

function metaFor(name: string): ToolMeta {
  return TOOL_META[name] ?? { verb: 'Checked', noun: 'note', running: 'Working…' };
}

function plural(noun: ToolMeta['noun'], count: number): string {
  if (count === 1) return noun;
  return noun === 'note' ? 'notes' : `${noun}s`;
}

function runningLabel(tool: ChatUiTool): string {
  const meta = metaFor(tool.name);
  const title = tool.title?.trim();
  if (!title) return meta.running;
  if (tool.name.startsWith('read_')) return `Reading “${title}”…`;
  if (tool.name.startsWith('edit_') || tool.name === 'update_note' || tool.name === 'append_note') {
    return `Editing “${title}”…`;
  }
  if (tool.name.startsWith('move_')) return `Moving “${title}”…`;
  if (tool.name === 'rename_folder') return `Renaming “${title}”…`;
  if (tool.name.startsWith('delete_')) return `Preparing to delete “${title}”…`;
  if (tool.name === 'update_board') return `Updating “${title}”…`;
  return meta.running;
}

function summarize(tools: ChatUiTool[]): string {
  if (tools.length === 0) return 'Checked the workspace';

  const groups = new Map<string, Map<ToolMeta['noun'], number>>();
  const order: string[] = [];

  for (const tool of tools) {
    const meta = metaFor(tool.name);
    if (!groups.has(meta.verb)) {
      groups.set(meta.verb, new Map());
      order.push(meta.verb);
    }
    const group = groups.get(meta.verb);
    if (!group) continue;
    group.set(meta.noun, (group.get(meta.noun) ?? 0) + 1);
  }

  const parts: string[] = [];
  for (const verb of order) {
    const group = groups.get(verb);
    if (!group) continue;
    const nouns = [...group.entries()].sort((a, b) => {
      if (a[0] === b[0]) return 0;
      if (a[0] === 'note') return -1;
      if (b[0] === 'note') return 1;
      return 0;
    });

    nouns.forEach(([noun, count], index) => {
      const label = `${count} ${plural(noun, count)}`;
      parts.push(index === 0 ? `${verb} ${label}` : label);
    });
  }

  return parts.join(' · ') || 'Checked the workspace';
}

function toolPresentation(tool: ChatUiTool): { primary: string; detail: string; noun: ToolMeta['noun'] } {
  const meta = metaFor(tool.name);
  const title = tool.title?.trim();
  if (title) return { primary: title, detail: meta.verb, noun: meta.noun };
  if (tool.name === 'list_folders') return { primary: 'Folders', detail: 'Checked', noun: 'folder' };
  if (tool.name === 'list_notes') return { primary: 'Notes', detail: 'Searched', noun: 'note' };
  if (tool.name === 'list_boards') return { primary: 'Boards', detail: 'Checked', noun: 'board' };
  if (tool.name === 'read_note') return { primary: 'Note', detail: 'Read', noun: 'note' };
  if (tool.name === 'read_board') return { primary: 'Board', detail: 'Read', noun: 'board' };
  return {
    primary: meta.noun === 'note' ? 'Note' : meta.noun === 'board' ? 'Board' : meta.noun === 'task' ? 'Task' : 'Folder',
    detail: meta.verb,
    noun: meta.noun,
  };
}

function ToolIcon({ noun }: { noun: ToolMeta['noun'] }) {
  if (noun === 'board') return <ViewColumnsIcon aria-hidden="true" />;
  if (noun === 'task') return <ListBulletIcon aria-hidden="true" />;
  if (noun === 'folder') return <FolderIcon aria-hidden="true" />;
  return <DocumentTextIcon aria-hidden="true" />;
}

function toolStatus(tool: ChatUiTool): { label: string; className: string } {
  if (tool.status === 'running') {
    return { label: 'Running', className: 'border-signal/25 bg-signal-soft text-signal' };
  }
  if (tool.status === 'error') {
    return { label: 'Failed', className: 'border-danger/25 bg-danger-soft text-danger' };
  }
  return { label: 'Done', className: 'border-line bg-surface-sunken text-ink-muted' };
}

function editSummary(edits: ChatUiEdit[]): string {
  const pending = edits.filter((edit) => edit.status === 'pending').length;
  const applied = edits.filter((edit) => edit.status === 'applied').length;
  if (pending > 0) return `${pending} change${pending === 1 ? '' : 's'} need confirmation`;
  if (applied > 0) return `${applied} change${applied === 1 ? '' : 's'} applied`;
  return `${edits.length} change${edits.length === 1 ? '' : 's'}`;
}

/** Compact, expandable tool activity. Never shows raw inputs or outputs. */
export function ChatToolStrip({
  tools,
  edits = [],
  streaming = false,
  onUndoEdit,
  onConfirmDelete,
  onCancelDelete,
}: ChatToolStripProps) {
  const [expanded, setExpanded] = useState(false);
  const urgentEdit = edits.some(
    (edit) => edit.status === 'pending' || edit.status === 'failed' || edit.status === 'conflict',
  );
  const running = [...tools].reverse().find((tool) => tool.status === 'running');
  const runningKey = running ? `${running.id ?? running.name}:${running.name}` : null;
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (urgentEdit) setExpanded(true);
  }, [urgentEdit]);

  // While a turn is running, keep the calls visible as they arrive. This is the
  // live, hierarchical view; once the answer finishes the user can collapse it.
  useEffect(() => {
    if (streaming && tools.length > 1) setExpanded(true);
  }, [streaming, tools.length]);

  useEffect(() => {
    if (!streaming || !runningKey) {
      startedAt.current = null;
      setElapsed(0);
      return;
    }
    if (startedAt.current === null) startedAt.current = Date.now();
    const tick = () => {
      if (startedAt.current === null) return;
      setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [runningKey, streaming]);

  if (tools.length === 0 && edits.length === 0) return null;

  const failed = tools.some((tool) => tool.status === 'error')
    || edits.some((edit) => edit.status === 'failed' || edit.status === 'conflict');
  const pending = edits.some((edit) => edit.status === 'pending');
  const dotClass = running
    ? 'animate-pulse bg-signal'
    : pending
      ? 'bg-warning'
      : failed
        ? 'bg-danger'
        : 'bg-success';
  const summary = running
    ? `${runningLabel(running)}${elapsed >= 8 ? ` · Still working… ${elapsed}s` : elapsed >= 3 ? ` · ${elapsed}s` : ''}`
    : tools.length > 0
      ? summarize(tools)
      : editSummary(edits);
  const canExpand = edits.length > 0 || tools.length > 1;

  return (
    <div className="mb-3" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span className="inline-flex h-7 min-w-0 items-center gap-2 rounded-[5px] border border-line bg-surface px-2.5 text-[11.5px] font-medium text-ink-secondary">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
          <span className="truncate">{summary}</span>
        </span>
        {canExpand && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-label={expanded ? 'Hide tool details' : 'Show tool details'}
            className="flex h-6 w-6 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            <ChevronDownIcon
              className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </button>
        )}
      </div>

      {expanded && (
        <ul className="mt-1.5 space-y-0.5 border-l border-line pl-3 text-[11.5px] text-ink-muted">
          {tools.map((tool, index) => {
            const presentation = toolPresentation(tool);
            const status = toolStatus(tool);
            const dotClass = tool.status === 'error'
              ? 'bg-danger'
              : tool.status === 'running'
                ? 'bg-signal animate-pulse'
                : 'bg-success';
            return (
              <li key={`${tool.id ?? tool.name}:${index}`}>
                <div className="flex min-w-0 items-center gap-2 rounded-[4px] px-1.5 py-1">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
                  <span className="shrink-0 text-ink-muted [&>svg]:h-3.5 [&>svg]:w-3.5">
                    <ToolIcon noun={presentation.noun} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-secondary">
                    <span className="font-medium text-ink-secondary">{presentation.primary}</span>
                    <span className="text-ink-muted"> · {presentation.detail}</span>
                  </span>
                  <span className={`inline-flex h-5 shrink-0 items-center rounded-[4px] border px-1.5 text-[10.5px] font-medium ${status.className}`}>
                    {status.label}
                  </span>
                  <span className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                </div>
              </li>
            );
          })}
          {tools.length > 0 && edits.length > 0 && (
            <li className="my-1 h-px bg-line" aria-hidden="true" />
          )}
          {edits.map((edit) => (
            <li key={edit.id}>
              <ChatEditCard
                edit={edit}
                onUndo={(id) => onUndoEdit?.(id)}
                onConfirm={(id) => onConfirmDelete?.(id)}
                onCancel={(id) => onCancelDelete?.(id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
