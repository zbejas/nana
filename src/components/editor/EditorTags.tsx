import { XMarkIcon } from '@heroicons/react/20/solid';

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
    <div className="border-b border-line bg-surface/30 px-3 py-2 sm:px-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="eyebrow mr-1">Tags</span>
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full border border-ember/25 bg-ember-soft py-0.5 pl-2 pr-1 text-[11px] text-ember"
          >
            {tag}
            {!readOnly && (
              <button
                onClick={() => onRemoveTag(tag)}
                className="rounded-full p-0.5 text-ember/70 transition-colors hover:bg-ember/15 hover:text-ember"
                aria-label={`Remove tag ${tag}`}
              >
                <XMarkIcon className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
        <input
          type="text"
          value={tagInput}
          onChange={(event) => onTagInputChange(event.target.value)}
          onKeyDown={onAddTag}
          readOnly={readOnly}
          placeholder={tags.length === 0 ? 'Add a tag and press Enter' : 'Add tag'}
          tabIndex={2}
          aria-label="Add a tag"
          className="min-w-[9rem] flex-1 border-none bg-transparent py-0.5 text-[12px] text-ink-secondary outline-none placeholder:text-ink-muted"
        />
      </div>
    </div>
  );
}
