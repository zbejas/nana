import { useState, useRef, useEffect } from 'react';
import { FolderIcon, DocumentTextIcon } from '@heroicons/react/24/outline';

const INDENT_PX = 16;

interface InlineNameInputProps {
  onSubmit: (name: string) => void;
  onCancel: () => void;
  placeholder?: string;
  icon?: 'folder' | 'document';
  depth?: number;
}

export function InlineNameInput({
  onSubmit,
  onCancel,
  placeholder = 'Name',
  icon = 'document',
  depth = 0,
}: InlineNameInputProps) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && name.trim()) {
      event.preventDefault();
      onSubmit(name.trim());
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  };

  const handleBlur = () => {
    if (name.trim()) {
      onSubmit(name.trim());
    } else {
      onCancel();
    }
  };

  const indent = depth * INDENT_PX + INDENT_PX;

  return (
    <div
      className="my-0.5 flex items-center gap-1.5 rounded-[6px] border border-signal/40 bg-surface-raised py-0.5 pr-2"
      style={{ paddingLeft: `${indent + 20}px` }}
    >
      {icon === 'folder' ? (
        <FolderIcon className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
      ) : (
        <DocumentTextIcon className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
      )}
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-6 min-w-0 flex-1 border-none bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-muted"
      />
    </div>
  );
}
