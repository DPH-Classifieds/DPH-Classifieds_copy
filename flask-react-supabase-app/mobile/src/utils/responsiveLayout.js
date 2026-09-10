import { useWindowDimensions } from 'react-native';

// Use the available window, not a device model. This updates automatically
// when a Fold opens, rotates, enters split-screen, or changes posture.
export const WINDOW_CLASSES = {
  compact: 'compact',
  medium: 'medium',
  expanded: 'expanded',
};

export const getWindowClass = (width) => {
  if (width < 600) return WINDOW_CLASSES.compact;
  if (width < 840) return WINDOW_CLASSES.medium;
  return WINDOW_CLASSES.expanded;
};

export const getResponsiveLayout = (width) => {
  const windowClass = getWindowClass(width);
  const isCompact = windowClass === WINDOW_CLASSES.compact;
  const isExpanded = windowClass === WINDOW_CLASSES.expanded;
  return {
    windowClass,
    isCompact,
    isExpanded,
    horizontalPadding: isCompact ? 16 : isExpanded ? 32 : 24,
    contentMaxWidth: isExpanded ? 1180 : 720,
    columns: isExpanded ? 2 : 1,
    cardImageHeight: isCompact ? 210 : 240,
  };
};

export function useResponsiveLayout() {
  const { width, height } = useWindowDimensions();
  return { width, height, ...getResponsiveLayout(width) };
}
