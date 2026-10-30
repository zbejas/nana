import darkMark from '../assets/nana-favicon.svg';
import lightMark from '../assets/nana-favicon-light.svg';
import { useTheme } from '../lib/theme';

/**
 * The rabbit-note mark without the app tile, for chrome that already has its
 * own surface. The auth cover is fixed dark, so it uses the dark asset
 * directly; the sidebar follows the app theme.
 */
export function BrandMark({ className = 'h-8 w-8' }: { className?: string }) {
  const { resolved } = useTheme();
  return (
    <img
      src={resolved === 'light' ? lightMark : darkMark}
      alt=""
      className={className}
      draggable={false}
      aria-hidden="true"
    />
  );
}
