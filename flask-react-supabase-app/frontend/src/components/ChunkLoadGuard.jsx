import React, { useEffect } from 'react';
import LoadingSpinner from './LoadingSpinner';

const CHUNK_RELOAD_KEY = 'dph_chunk_reload_attempted';

const isChunkLoadError = (error) => {
  const message = String(error?.message || error || '');
  return (
    error?.name === 'ChunkLoadError' ||
    /Loading chunk [\w-]+ failed/i.test(message) ||
    /chunkloaderror/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message)
  );
};

const hasReloadMarker = () => {
  try {
    if (window.sessionStorage.getItem(CHUNK_RELOAD_KEY) === '1') {
      return true;
    }
  } catch (error) {
    /* ignore */
  }

  return String(window.name || '').split('|').includes(CHUNK_RELOAD_KEY);
};

const shouldReloadOnce = () => {
  if (hasReloadMarker()) {
    return false;
  }

  try {
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
  } catch (error) {
    /* session storage unavailable */
  }

  window.name = `${window.name || ''}|${CHUNK_RELOAD_KEY}`;
  return true;
};

export const ChunkLoadRecovery = () => {
  useEffect(() => {
    const handleFailure = (error) => {
      if (!isChunkLoadError(error)) {
        return;
      }
      if (shouldReloadOnce()) {
        window.location.reload();
      }
    };

    const handleWindowError = (event) => {
      handleFailure(event?.error || event?.message);
    };

    const handleRejection = (event) => {
      handleFailure(event?.reason);
    };

    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  useEffect(() => {
    try {
      window.sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    } catch (error) {
      /* session storage not available */
    }
    if (window.name) {
      window.name = window.name
        .split('|')
        .filter((part) => part && part !== CHUNK_RELOAD_KEY)
        .join('|');
    }
  }, []);

  return null;
};

export class ChunkLoadErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      isChunkError: false,
    };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      isChunkError: isChunkLoadError(error),
    };
  }

  componentDidCatch(error) {
    if (isChunkLoadError(error) && shouldReloadOnce()) {
      window.location.reload();
    }
  }

  handleReload = () => {
    try {
      window.sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    } catch (error) {
      /* ignore */
    }
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (!this.state.isChunkError) {
      return (
        <div
          style={{
            minHeight: '50vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '32px 16px',
          }}
        >
          <div style={{ maxWidth: 520, textAlign: 'center' }}>
            <h2 style={{ marginBottom: 12, color: '#fff' }}>Something went wrong</h2>
            <p style={{ marginBottom: 20, color: 'rgba(255,255,255,0.72)' }}>
              Reload the app. If the problem keeps happening, the browser may need a fresh build.
            </p>
            <button
              type="button"
              onClick={this.handleReload}
              style={{
                border: 'none',
                borderRadius: 999,
                padding: '12px 18px',
                background: '#8bd6b4',
                color: '#041008',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Reload app
            </button>
          </div>
        </div>
      );
    }

    return (
      <div style={{ minHeight: '50vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <LoadingSpinner message="Refreshing the app bundle..." size="large" />
      </div>
    );
  }
}
