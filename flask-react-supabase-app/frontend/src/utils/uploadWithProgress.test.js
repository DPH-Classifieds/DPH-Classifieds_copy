import { uploadProgressLabel } from './uploadWithProgress';

test('upload progress labels tell the user when upload is complete and OCR is running', () => {
  expect(uploadProgressLabel({ percent: 42, phase: 'uploading' })).toBe('Uploading document… 42%');
  expect(uploadProgressLabel({ percent: 100, phase: 'scanning' })).toBe('Upload complete · scanning document…');
});
