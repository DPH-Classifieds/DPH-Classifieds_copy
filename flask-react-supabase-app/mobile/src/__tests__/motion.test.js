import { SPRING_FAST, SPRING_NORMAL, SPRING_SLOW, FADE_DURATION, STAGGER_DELAY, ENTRANCE_DISTANCE } from '../constants/motion';

test('SPRING_FAST has damping 20 stiffness 300', () => {
  expect(SPRING_FAST).toEqual({ damping: 20, stiffness: 300 });
});
test('FADE_DURATION is 220', () => { expect(FADE_DURATION).toBe(220); });
test('STAGGER_DELAY is 40', () => { expect(STAGGER_DELAY).toBe(40); });
test('ENTRANCE_DISTANCE is 16', () => { expect(ENTRANCE_DISTANCE).toBe(16); });
