import {
  ChevronLeftIcon,
  ClockIcon,
  FolderIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline';
import logo from '../../assets/nana.svg';

interface SidebarFooterProps {
  onToggle: () => void;
  isMobile: boolean;
  viewLinks: Array<{ key: string; label: string; path: string; icon: React.ComponentType<React.SVGProps<SVGSVGElement>> }>;
  currentPath: string;
  onNavigate: (path: string) => void;
}

export function SidebarFooter({ onToggle, isMobile, viewLinks, currentPath, onNavigate }: SidebarFooterProps) {
  return (
    <div className="mt-auto border-t border-white/10">
      {/* View navigation — stacked */}
      <div className="px-3 pt-2 pb-1 space-y-0.5">
        {viewLinks.map((item) => {
          const Icon = item.icon;
          const isActive = currentPath === item.path || currentPath.startsWith(`${item.path}/`);

          return (
            <button
              key={item.key}
              onClick={() => onNavigate(item.path)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-colors ${
                isActive
                  ? 'bg-white/8 text-white'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span>{item.label}</span>
              {isActive && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-400" />}
            </button>
          );
        })}
      </div>

      {/* Bottom bar: collapse toggle + logo */}
      <div className="px-3 pb-3 pt-1 flex items-center justify-between">
        <button
          onClick={onToggle}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-colors text-sm md:px-2.5 md:py-1.5 md:text-xs"
          title={isMobile ? "Close menu" : "Collapse sidebar"}
          aria-label={isMobile ? "Close menu" : "Collapse sidebar"}
        >
          <ChevronLeftIcon className="w-5 h-5 md:w-4 md:h-4" />
          <span>{isMobile ? 'Close' : 'Collapse'}</span>
        </button>

        <div className="flex items-center gap-1.5 select-none opacity-30">
          <img src={logo} alt="Nana" className="h-4 w-4" draggable={false} />
          <span className="text-[11px] font-medium text-gray-500">Nana</span>
        </div>
      </div>
    </div>
  );
}
