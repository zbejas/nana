import { useState, useRef, useEffect } from 'react';
import { FolderIcon, DocumentTextIcon } from '@heroicons/react/24/outline';

const INDENT_PX = 20;

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
  placeholder = 'Enter name...', 
  icon = 'document',
  depth = 0 
}: InlineNameInputProps) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && name.trim()) {
      e.preventDefault();
      onSubmit(name.trim());
    } else if (e.key === 'Escape') {
      e.preventDefault();
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

  const indent = depth * INDENT_PX;

  return (
    <div 
      className="flex items-center gap-1.5 py-[5px] bg-white/8 rounded-md"
      style={{ paddingLeft: `${indent + 4}px`, paddingRight: '0.5rem' }}
    >
      <div className="w-4 flex-shrink-0" /> {/* chevron placeholder */}
      {icon === 'folder' ? (
        <FolderIcon className="w-4 h-4 text-yellow-500/80 flex-shrink-0" />
      ) : (
        <DocumentTextIcon className="w-4 h-4 text-gray-500 flex-shrink-0" />
      )}
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={placeholder}
        className="flex-1 min-w-0 bg-transparent border-none outline-none text-[13px] text-gray-200 placeholder-gray-500"
      />
    </div>
  );
}
