import {
  ArrowRightIcon,
  DocumentTextIcon,
  FolderIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  SparklesIcon,
  ViewColumnsIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import { Button } from '../ui';
import type { ChatContextTarget } from '../../lib/chat/context';
import type { ChatMode } from '../../lib/chat/types';

interface ChatEmptyStateProps {
  target: ChatContextTarget | null;
  mode: ChatMode;
  configured: boolean | null;
  onPrompt: (prompt: string) => void;
  onOpenSettings: () => void;
}

interface Prompt {
  icon: typeof SparklesIcon;
  prompt: string;
}

const GENERIC_PROMPTS: Prompt[] = [
  { icon: SparklesIcon, prompt: 'What changed in my notes this week?' },
  { icon: ViewColumnsIcon, prompt: 'Summarise my board.' },
  { icon: MagnifyingGlassIcon, prompt: 'Find the note about …' },
  { icon: DocumentTextIcon, prompt: 'What should I work on next?' },
];

const NOTE_PROMPTS: Prompt[] = [
  { icon: DocumentTextIcon, prompt: 'Summarise this note.' },
  { icon: SparklesIcon, prompt: 'What are the open questions here?' },
  { icon: MagnifyingGlassIcon, prompt: 'Find gaps or unclear claims.' },
  { icon: ViewColumnsIcon, prompt: 'Turn the action items into tasks.' },
];

const BOARD_PROMPTS: Prompt[] = [
  { icon: ViewColumnsIcon, prompt: 'Summarise this board.' },
  { icon: SparklesIcon, prompt: 'What is blocked or overdue?' },
  { icon: DocumentTextIcon, prompt: 'What should I work on next?' },
  { icon: MagnifyingGlassIcon, prompt: 'Find tasks missing a next step.' },
];

const FOLDER_PROMPTS: Prompt[] = [
  { icon: FolderIcon, prompt: 'What is in this folder?' },
  { icon: SparklesIcon, prompt: 'What changed here recently?' },
  { icon: DocumentTextIcon, prompt: 'Which notes need attention?' },
  { icon: MagnifyingGlassIcon, prompt: 'Find the note about …' },
];

function promptSet(target: ChatContextTarget | null): Prompt[] {
  if (target?.type === 'document') return NOTE_PROMPTS;
  if (target?.type === 'board') return BOARD_PROMPTS;
  if (target?.type === 'folder') return FOLDER_PROMPTS;
  return GENERIC_PROMPTS;
}

function nounFor(target: ChatContextTarget): string {
  if (target.type === 'document') return 'note';
  if (target.type === 'board') return 'board';
  return 'folder';
}

export function ChatEmptyState({ target, mode, configured, onPrompt, onOpenSettings }: ChatEmptyStateProps) {
  if (configured === false) {
    return (
      <div className="my-auto w-full py-4">
        <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-[8px] border border-line bg-surface-sunken text-ink-muted">
          <WrenchScrewdriverIcon className="h-5 w-5" aria-hidden="true" />
        </span>
        <h2 className="text-[17px] font-semibold leading-snug tracking-[-0.015em] text-ink">
          Connect a model to chat.
        </h2>
        <p className="mt-1.5 max-w-[52ch] text-[13.5px] leading-relaxed text-ink-secondary">
          Choose a provider and model in Settings → AI. Nothing is sent until you do.
        </p>
        <Button variant="secondary" className="mt-4" onClick={onOpenSettings}>
          Open AI settings
        </Button>
      </div>
    );
  }

  const privateNoun = target ? nounFor(target) : 'page';
  const prompts = target?.isPrivate ? GENERIC_PROMPTS : promptSet(target);

  const workMode = mode === 'edit';
  let title = workMode ? 'Ask, or change something.' : 'Ask your notes.';
  let description = workMode
    ? 'Nana can search and read your notes and boards, answer from them, and make the changes you ask for.'
    : 'Nana can search and read your notes and boards, then answer from what it finds.';

  if (target?.isPrivate) {
    title = 'Ask about something else.';
    description = `This ${privateNoun} stays private and will not be attached. Nana can still search your other notes and boards.`;
  } else if (target?.type === 'document') {
    title = workMode ? 'Work on this note.' : 'Ask about this note.';
    description = workMode
      ? 'Nana can read this note, answer questions, and make the change you ask for.'
      : 'Nana can read this note when it needs to. Ask for a summary, a decision, or the next step.';
  } else if (target?.type === 'board') {
    title = workMode ? 'Work on this board.' : 'Ask about this board.';
    description = workMode
      ? 'Nana can read this board and its tasks, answer questions, and make the task changes you ask for.'
      : 'Nana can read this board and its tasks. Ask what is moving, blocked, or next.';
  } else if (target?.type === 'folder') {
    title = workMode ? 'Work in this folder.' : 'Ask about this folder.';
    description = workMode
      ? 'Nana can list this folder and read or change what is inside it when you ask.'
      : 'Nana can list this folder and read the notes inside it.';
  }

  return (
    <div className="my-auto w-full py-3">
      {target?.isPrivate && (
        <div className="mb-5 rounded-control border border-warning/25 bg-warning-soft px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-secondary">
          <p className="flex items-center gap-2 font-medium text-warning">
            <LockClosedIcon className="h-4 w-4" aria-hidden="true" />
            Nana can’t see this {privateNoun}.
          </p>
          <p className="mt-1">
            Private notes, boards, and folders are hidden from AI. Remove privacy to ask about it,
            or ask something else — the page will not be attached to your message.
          </p>
        </div>
      )}

      <h2 className="text-[26px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-[30px]">
        {title}
      </h2>
      <p className="mt-2.5 max-w-[52ch] text-[14px] leading-relaxed text-ink-secondary">
        {description}
      </p>

      <div className="mt-6 grid w-full gap-2.5 sm:grid-cols-2">
        {prompts.map(({ icon: Icon, prompt }) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPrompt(prompt)}
            className="group flex min-h-[4rem] items-start gap-3 rounded-panel border border-line bg-surface p-3 text-left transition-colors hover:border-line-strong hover:bg-surface-raised sm:min-h-[5rem] sm:p-3.5"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] border border-line bg-surface-sunken text-ink-muted">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1 pt-0.5 text-[13px] font-medium leading-snug text-ink-secondary group-hover:text-ink">
              {prompt}
            </span>
            <ArrowRightIcon
              className="mt-1 h-3.5 w-3.5 shrink-0 text-ink-muted transition-colors group-hover:text-ink"
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
