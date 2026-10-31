import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircleIcon,
  CodeBracketSquareIcon,
  ChatBubbleBottomCenterTextIcon,
  ListBulletIcon,
  NumberedListIcon,
  MinusIcon,
  TableCellsIcon,
  PencilIcon,
} from '@heroicons/react/24/outline';
import { MenuItem, MenuLabel, MenuSurface } from '../../ui';
import { filterSlashMenuItems, type EditorActionId } from './helpers';

interface NanaSlashMenuProps {
  open: boolean;
  position: { left: number; top: number } | null;
  onSelect: (action: EditorActionId) => void;
  onClose: () => void;
}

function actionIcon(action: EditorActionId) {
  switch (action) {
    case 'heading-1':
    case 'heading-2':
    case 'heading-3':
      return <span className="w-4 text-center text-[11px] font-semibold">{action.slice(-1)}</span>;
    case 'bullet-list':
      return <ListBulletIcon />;
    case 'ordered-list':
      return <NumberedListIcon />;
    case 'task-list':
      return <CheckCircleIcon />;
    case 'quote':
      return <ChatBubbleBottomCenterTextIcon />;
    case 'code-block':
      return <CodeBracketSquareIcon />;
    case 'table':
      return <TableCellsIcon />;
    case 'divider':
      return <MinusIcon />;
    default:
      return <PencilIcon />;
  }
}

/**
 * A React slash menu. The ProseMirror key handler opens it without inserting
 * the slash; while it is open, key events are captured here so typing filters
 * the list instead of leaking into the document.
 */
export function NanaSlashMenu({ open, position, onSelect, onClose }: NanaSlashMenuProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const items = useMemo(() => filterSlashMenuItems(query), [query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex((index) => Math.min(index, Math.max(0, items.length - 1)));
  }, [items.length, open]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[activeIndex]?.focus({ preventScroll: true });
  }, [activeIndex, open, items.length]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        setActiveIndex((index) => (items.length ? (index + 1) % items.length : 0));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        setActiveIndex((index) => (items.length ? (index - 1 + items.length) % items.length : 0));
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        const item = items[activeIndex];
        if (item) onSelect(item.id);
        return;
      }
      if (event.key === 'Backspace') {
        event.preventDefault();
        event.stopPropagation();
        setQuery((current) => current.slice(0, -1));
        return;
      }
      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        setQuery((current) => `${current}${event.key}`);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [activeIndex, items, onClose, onSelect, open]);

  if (!open || !position || typeof window === 'undefined') return null;

  const width = 272;
  const left = Math.min(Math.max(8, position.left), Math.max(8, window.innerWidth - width - 8));
  const top = Math.min(Math.max(8, position.top), Math.max(8, window.innerHeight - 340));

  return (
    <MenuSurface
      open={open}
      onClose={onClose}
      position={{ left, top, width }}
      ariaLabel="Insert block"
    >
      <MenuLabel>{query ? `/${query}` : 'Insert block'}</MenuLabel>
      <div className="max-h-[19rem] overflow-y-auto">
        {items.length === 0 ? (
          <p className="px-3 py-2 text-[12.5px] text-ink-muted">No matching blocks</p>
        ) : (
          items.map((item, index) => (
            <button
              key={item.id}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              type="button"
              role="menuitem"
              onClick={() => onSelect(item.id)}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors ${
                index === activeIndex ? 'bg-surface-sunken text-ink' : 'text-ink-secondary hover:bg-surface-sunken hover:text-ink'
              } [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0`}
            >
              {actionIcon(item.id)}
              <span className="flex-1 truncate">{item.label}</span>
              <span className="text-[11px] text-ink-muted">{item.hint}</span>
            </button>
          ))
        )}
      </div>
      <p className="border-t border-line px-3 py-1.5 text-[10.5px] text-ink-muted">
        Type to filter · ↑↓ to move · Enter to insert
      </p>
    </MenuSurface>
  );
}
