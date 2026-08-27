import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChunkLoadErrorBoundary, ChunkLoadRecovery } from './ChunkLoadGuard';

const CHUNK_RELOAD_KEY = 'dph_chunk_reload_attempted';

describe('ChunkLoadGuard — post-deploy recovery', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.name = '';
  });

  describe('ChunkLoadRecovery', () => {
    test('does not immediately clear the reload marker on mount', () => {
      // Regression: if a fresh page load (post-reload) wipes the marker
      // synchronously on mount, a chunk that fails again right away (a
      // permanently broken asset, not a stale index.html) will trigger
      // another auto-reload instead of stopping — an infinite loop.
      jest.useFakeTimers();
      window.sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');

      render(<ChunkLoadRecovery />);

      expect(window.sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBe('1');

      jest.advanceTimersByTime(5000);
      expect(window.sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBeNull();

      jest.useRealTimers();
    });
  });

  describe('ChunkLoadErrorBoundary', () => {
    const Bomb = ({ shouldThrow }) => {
      if (shouldThrow) {
        const err = new Error('Loading chunk 409 failed');
        err.name = 'ChunkLoadError';
        throw err;
      }
      return <div>CHILD_OK</div>;
    };

    test('renders children when no error', () => {
      render(
        <ChunkLoadErrorBoundary>
          <Bomb shouldThrow={false} />
        </ChunkLoadErrorBoundary>
      );
      expect(screen.getByText('CHILD_OK')).toBeInTheDocument();
    });

    test('shows a manual reload button when stuck on a chunk error', () => {
      // Simulate "already reloaded once" by pre-setting the marker so the
      // auto-reload path is consumed. The user must still have an escape
      // hatch.
      window.sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');

      render(
        <ChunkLoadErrorBoundary>
          <Bomb shouldThrow={true} />
        </ChunkLoadErrorBoundary>
      );

      expect(screen.getByText(/Refreshing the app bundle/i)).toBeInTheDocument();
      const button = screen.getByRole('button', { name: /reload app/i });
      expect(button).toBeInTheDocument();

      fireEvent.click(button);
      // The click handler must clear the marker so the next mount is not
      // poisoned by a leftover reload-once marker. We can't stub
      // window.location.reload in jsdom (it's non-configurable), so we
      // assert the side effect we can observe.
      expect(window.sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBeNull();
    });
  });
});