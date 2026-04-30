export const SUPPORT_EMAIL = 'support@dphclassifieds.com';

export const buildErrorNotice = (error, fallbackMessage = 'Something went wrong.') => {
  if (!error) {
    return null;
  }

  if (typeof error === 'string') {
    return {
      message: error,
      code: null,
      details: null,
    };
  }

  const details = error.details || error.response?.data || error.data || null;

  return {
    message:
      error.message ||
      details?.message ||
      details?.error ||
      fallbackMessage,
    code: error.code || details?.code || null,
    details,
  };
};

export const buildDealerHelpMailto = ({
  subject = 'Dealer listing assistance',
  body = '',
} = {}) => {
  const nextSubject = encodeURIComponent(subject);
  const nextBody = encodeURIComponent(body);
  return `mailto:${SUPPORT_EMAIL}?subject=${nextSubject}&body=${nextBody}`;
};
