import { getResponsiveLayout, getWindowClass } from '../responsiveLayout';

test('uses available window width classes for phones and foldables', () => {
  expect(getWindowClass(402)).toBe('compact');
  expect(getWindowClass(600)).toBe('medium');
  expect(getWindowClass(839)).toBe('medium');
  expect(getWindowClass(840)).toBe('expanded');
});
test('keeps content readable and adds a second column on expanded windows', () => {
  expect(getResponsiveLayout(402)).toMatchObject({
    horizontalPadding: 16,
    contentMaxWidth: 720,
    columns: 1,
  });
  expect(getResponsiveLayout(1000)).toMatchObject({
    horizontalPadding: 32,
    contentMaxWidth: 1180,
    columns: 2,
  });
});
