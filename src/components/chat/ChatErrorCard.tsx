import { ArrowPathIcon, ExclamationTriangleIcon, WrenchScrewdriverIcon } from '@heroicons/react/24/outline';
import { Button } from '../ui';
import type { ChatError } from '../../lib/chat/types';

interface ChatErrorCardProps {
  error: ChatError;
  onRetry: () => void;
  onOpenSettings: () => void;
}

interface ErrorCopy {
  title: string;
  body: string;
  settings?: boolean;
  retry?: boolean;
}

function errorCopy(error: ChatError): ErrorCopy {
  const code = (error.code ?? '').toLowerCase();
  const message = error.message.toLowerCase();

  if (error.status === 401 || code === 'unauthorized') {
    return {
      title: 'Your session ended',
      body: 'Sign in again, then retry the message.',
      retry: false,
    };
  }
  if (error.status === 503 || code === 'ai_not_configured' || code === 'unavailable') {
    return {
      title: 'Nana is not configured',
      body: 'Choose a provider and model in Settings → AI before asking a question.',
      settings: true,
      retry: false,
    };
  }
  if (code === 'model_not_found' || message.includes('model not found')) {
    return {
      title: 'That model is unavailable',
      body: 'Pick a different model in Settings → AI, then try again.',
      settings: true,
    };
  }
  if (
    code === 'provider_unreachable'
    || message.includes('econnrefused')
    || message.includes('connection refused')
    || message.includes('fetch failed')
    || message.includes('cannot connect')
  ) {
    return {
      title: 'Nana cannot reach the provider',
      body: 'Check that the AI provider is running and that its URL is correct.',
      settings: true,
    };
  }
  if (error.status === 429 || code === 'rate_limit' || message.includes('too many')) {
    return {
      title: 'Too many messages just now',
      body: 'Wait a moment, then try again. Your message is still here.',
    };
  }
  if (error.status === 409 || code === 'conflict') {
    return {
      title: 'That item changed',
      body: 'It was updated while Nana was working. Re-read the page and try again.',
    };
  }
  if (error.status === 404 || code === 'not_found') {
    return {
      title: 'That page is not available',
      body: 'It may have been moved, deleted, or made private. Go back to the page and try again.',
    };
  }
  return {
    title: 'Nana stopped partway through',
    body: error.message || 'Try again, or narrow the question to one note or board.',
  };
}

/** Inline failure under the last user message. Never replaces the prompt. */
export function ChatErrorCard({ error, onRetry, onOpenSettings }: ChatErrorCardProps) {
  const copy = errorCopy(error);
  return (
    <div
      role="alert"
      className="rounded-panel border border-danger/25 bg-danger-soft px-3.5 py-3 text-[13px] leading-relaxed text-ink"
    >
      <div className="flex items-start gap-2.5">
        <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-danger">{copy.title}</p>
          <p className="mt-1 text-ink-secondary">{copy.body}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {copy.retry !== false && (
              <Button variant="secondary" size="sm" icon={<ArrowPathIcon />} onClick={onRetry}>
                Try again
              </Button>
            )}
            {copy.settings && (
              <Button variant="ghost" size="sm" icon={<WrenchScrewdriverIcon />} onClick={onOpenSettings}>
                AI settings
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
