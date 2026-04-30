import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from './button';

const ActionNoticeModal = ({
  open,
  title = 'Notice',
  message = '',
  details = null,
  actions = [],
  onClose,
}) => {
  if (!open) {
    return null;
  }

  return (
    <div className="post-notice-overlay" role="presentation" onClick={onClose}>
      <div
        className="post-notice-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="post-notice-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="post-notice-close" onClick={onClose} aria-label="Close notice">
          <X size={18} />
        </button>

        <div className="post-notice-icon">
          <AlertTriangle size={22} />
        </div>

        <div className="post-notice-content">
          <p className="post-notice-kicker">Attention</p>
          <h2 id="post-notice-title">{title}</h2>
          <p className="post-notice-message">{message}</p>
          {details?.limit || details?.current ? (
            <div className="post-notice-meta">
              {details.limit ? <span>Limit: {details.limit}</span> : null}
              {details.current ? <span>Current: {details.current}</span> : null}
            </div>
          ) : null}
        </div>

        {actions.length > 0 ? (
          <div className="post-notice-actions">
            {actions.map((action) =>
              action.href ? (
                <Button
                  key={action.label}
                  asChild
                  variant={action.variant || 'secondary'}
                  className="post-notice-action"
                >
                  <a href={action.href} target={action.target || '_self'} rel={action.rel || undefined}>
                    {action.label}
                  </a>
                </Button>
              ) : (
                <Button
                  key={action.label}
                  type="button"
                  variant={action.variant || 'secondary'}
                  className="post-notice-action"
                  onClick={action.onClick}
                >
                  {action.label}
                </Button>
              )
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default ActionNoticeModal;
