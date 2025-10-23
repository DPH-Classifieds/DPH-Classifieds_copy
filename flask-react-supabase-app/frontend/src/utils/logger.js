/**
 * Conditional logging utility
 * Only logs in development mode to reduce console noise in production
 */

const isDevelopment = process.env.NODE_ENV === 'development';

const logger = {
  /**
   * Debug-level logging - only in development
   * Use for detailed debugging information
   */
  debug: (...args) => {
    if (isDevelopment) {
      console.log('[DEBUG]', ...args);
    }
  },

  /**
   * Info-level logging - only in development
   * Use for general information
   */
  info: (...args) => {
    if (isDevelopment) {
      console.info('[INFO]', ...args);
    }
  },

  /**
   * Warning-level logging - always logged
   * Use for recoverable errors or important warnings
   */
  warn: (...args) => {
    console.warn('[WARN]', ...args);
  },

  /**
   * Error-level logging - always logged
   * Use for errors that need attention
   */
  error: (...args) => {
    console.error('[ERROR]', ...args);
  },

  /**
   * Group logging - only in development
   * Use for grouping related log messages
   */
  group: (label, callback) => {
    if (isDevelopment) {
      console.group(label);
      callback();
      console.groupEnd();
    }
  },

  /**
   * Table logging - only in development
   * Use for displaying tabular data
   */
  table: (data) => {
    if (isDevelopment && console.table) {
      console.table(data);
    }
  },

  /**
   * Time tracking - only in development
   * Use for performance measurement
   */
  time: (label) => {
    if (isDevelopment) {
      console.time(label);
    }
  },

  timeEnd: (label) => {
    if (isDevelopment) {
      console.timeEnd(label);
    }
  }
};

export default logger;
