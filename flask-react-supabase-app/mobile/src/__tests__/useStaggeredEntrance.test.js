import { renderHook } from '@testing-library/react-native';
import { useStaggeredEntrance } from '../hooks/useStaggeredEntrance';

test('returns an object with animatedStyle key at index 0', () => {
  const { result } = renderHook(() => useStaggeredEntrance(0));
  expect(result.current).toHaveProperty('animatedStyle');
});

test('returns animatedStyle at high index', () => {
  const { result } = renderHook(() => useStaggeredEntrance(20));
  expect(result.current).toHaveProperty('animatedStyle');
});
