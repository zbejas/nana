import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';
import { useAtom } from 'jotai';
import { chatDockOpenAtom } from '../../state/atoms';
import { IconButton } from '../ui';

interface ChatHeaderButtonProps {
  className?: string;
}

/**
 * The primary pages keep Nana one click away without a permanent Chat row in
 * the sidebar. It toggles the same persistent dock that Cmd/Ctrl+J opens.
 */
export function ChatHeaderButton({ className = '' }: ChatHeaderButtonProps) {
  const [open, setOpen] = useAtom(chatDockOpenAtom);

  return (
    <IconButton
      label={open ? 'Close chat' : 'Open chat'}
      size="md"
      aria-pressed={open}
      onClick={() => setOpen((value) => !value)}
      className={`${open ? 'bg-signal-soft text-signal' : ''} ${className}`}
    >
      <ChatBubbleLeftRightIcon />
    </IconButton>
  );
}
