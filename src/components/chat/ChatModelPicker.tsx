import { useRef, useState } from 'react';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import type { AIChatModelOption } from '../../lib/ai/types';
import { useIsMobileChat } from '../../lib/chat/viewport';
import { Badge, MenuSurface, Sheet, cn } from '../ui';

interface ChatModelPickerProps {
  models: AIChatModelOption[];
  selectedModelId: string | null;
  onSelect: (modelId: string) => void;
  disabled?: boolean;
  className?: string;
}

function capabilityHint(model: AIChatModelOption): string {
  const values: string[] = [];
  if (model.vision) values.push('Vision');
  if (model.files) values.push('PDF');
  if (model.tools) values.push('Tools');
  if (model.local) values.push('Local');
  return values.join(' · ');
}

function ModelList({
  models,
  selectedModelId,
  onSelect,
}: {
  models: AIChatModelOption[];
  selectedModelId: string | null;
  onSelect: (modelId: string) => void;
}) {
  return (
    <div className="space-y-1 p-1.5">
      {models.map((model) => {
        const selected = model.id === selectedModelId;
        const hint = capabilityHint(model);
        return (
          <button
            key={model.id}
            type="button"
            role="menuitemradio"
            aria-checked={selected}
            onClick={() => onSelect(model.id)}
            className={cn(
              'flex w-full items-start gap-2 rounded-control px-2.5 py-2 text-left transition-colors',
              selected ? 'bg-signal-soft text-ink' : 'text-ink-secondary hover:bg-surface-sunken hover:text-ink',
            )}
            aria-pressed={selected}
          >
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-60" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-[12.5px] font-medium">{model.label}</span>
                {model.contextWindow && (
                  <Badge tone="neutral">{Math.round(model.contextWindow / 1000)}k ctx</Badge>
                )}
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-ink-muted">
                {model.provider} · {model.model}
              </span>
              {hint && <span className="mt-1 block text-[10.5px] text-ink-muted">{hint}</span>}
            </span>
            {selected && <span className="mt-1 text-[11px] font-medium text-signal">Selected</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Compact model selector shared by the dock and the full-page composer. */
export function ChatModelPicker({
  models,
  selectedModelId,
  onSelect,
  disabled = false,
  className,
}: ChatModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const isMobile = useIsMobileChat();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = models.find((model) => model.id === selectedModelId) ?? models[0] ?? null;
  const label = selected?.label ?? 'Default model';

  if (models.length === 0) return null;

  const choose = (id: string) => {
    onSelect(id);
    setOpen(false);
  };

  const toggle = () => {
    if (disabled) return;
    setAnchor(triggerRef.current?.getBoundingClientRect() ?? null);
    setOpen((value) => !value);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-label="Chat model"
        aria-haspopup="menu"
        aria-expanded={open}
        title={selected ? `${selected.provider} · ${selected.model}` : label}
        className={cn(
          'inline-flex h-8 min-w-0 max-w-[12rem] items-center gap-1.5 rounded-control border border-line bg-surface-sunken px-2 text-[11.5px] font-medium text-ink-secondary transition-colors hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 sm:max-w-[15rem]',
          open && 'border-signal/40 bg-signal-soft text-signal',
          className,
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronDownIcon className="h-3 w-3 shrink-0 opacity-70" aria-hidden="true" />
      </button>

      {isMobile ? (
        <Sheet open={open} onClose={() => setOpen(false)} title="Chat model">
          <div className="max-h-[65dvh] overflow-y-auto">
            <ModelList models={models} selectedModelId={selected?.id ?? null} onSelect={choose} />
          </div>
        </Sheet>
      ) : (
        <MenuSurface
          open={open}
          onClose={() => setOpen(false)}
          position={{
            left: Math.max(8, Math.min(anchor?.left ?? 8, window.innerWidth - 300)),
            bottom: Math.max(8, window.innerHeight - (anchor?.top ?? 40) + 8),
          }}
          ariaLabel="Chat model"
          className="w-[18rem] min-w-[18rem] max-w-[18rem] p-0"
        >
          <ModelList models={models} selectedModelId={selected?.id ?? null} onSelect={choose} />
        </MenuSurface>
      )}
    </>
  );
}
