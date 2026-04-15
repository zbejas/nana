interface EditorTagsProps {
  tags: string[];
  tagInput: string;
  readOnly?: boolean;
  onTagInputChange: (value: string) => void;
  onAddTag: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onRemoveTag: (tag: string) => void;
}

export function EditorTags({
  tags,
  tagInput,
  readOnly = false,
  onTagInputChange,
  onAddTag,
  onRemoveTag,
}: EditorTagsProps) {
  return (
    <div className="px-4 py-3 border-b border-white/10 dark:border-white/10 light:border-gray-300 bg-white/5 dark:bg-white/5 light:bg-white/70 backdrop-blur-sm">
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-sm text-gray-400 light:text-gray-600">Tags:</span>
        {tags.map(tag => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-1 bg-blue-500/20 text-blue-200 light:text-blue-700 rounded-md text-sm"
          >
            {tag}
            <button
              onClick={() => onRemoveTag(tag)}
              disabled={readOnly}
              className="hover:text-white light:hover:text-blue-900"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        ))}
        <input
          type="text"
          value={tagInput}
          onChange={(e) => onTagInputChange(e.target.value)}
          onKeyDown={onAddTag}
          readOnly={readOnly}
          placeholder="Add tag (press Enter)"
          tabIndex={2}
          className="flex-1 min-w-[150px] bg-transparent border-none outline-none text-sm text-gray-300 light:text-gray-700 placeholder-gray-500 light:placeholder-gray-400"
        />
      </div>
    </div>
  );
}
