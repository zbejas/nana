import { type ReactNode } from 'react';

interface CollapsibleSectionProps {
  title: string;
  isCollapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
  headerAction?: ReactNode;
}

export function CollapsibleSection({ 
  title, 
  isCollapsed, 
  onToggle, 
  children, 
  headerAction 
}: CollapsibleSectionProps) {
  return (
    <div>
      <div className="relative flex items-center">
        <button
          onClick={onToggle}
          className="flex-1 flex items-center gap-2 text-[11px] text-gray-500 uppercase font-semibold tracking-wider px-2 py-1.5 hover:text-gray-400 transition-colors"
        >
          <svg 
            className={`w-3 h-3 transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          {title}
        </button>
        {headerAction && (
          <div className="flex items-center mr-1">
            {headerAction}
          </div>
        )}
      </div>
      <div className={`overflow-hidden transition-all duration-200 ${isCollapsed ? 'max-h-0 opacity-0' : 'max-h-[2000px] opacity-100'}`}>
        <div className="pt-1 space-y-0.5">
          {children}
        </div>
      </div>
    </div>
  );
}
