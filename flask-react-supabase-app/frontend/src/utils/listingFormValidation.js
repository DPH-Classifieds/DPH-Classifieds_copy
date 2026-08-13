const escapeSelector = (value) => String(value || '').replace(/(["\\])/g, '\\$1');

export const firstMissingRequiredField = (form) => {
  if (!form) return null;
  const fields = Array.from(form.querySelectorAll('[required]'));
  return fields.find((field) => {
    if (field.disabled) return false;
    if (field.type === 'checkbox' || field.type === 'radio') return !field.checked;
    return String(field.value || '').trim() === '';
  }) || null;
};

export const fieldLabel = (form, field) => {
  if (!field) return 'this field';
  const fieldId = field.dataset?.fieldId || field.id;
  const label = field.labels?.[0]
    || (fieldId && form?.querySelector(`label[for="${escapeSelector(fieldId)}"]`));
  return label?.textContent?.replace(/\*/g, '').replace(/\s+/g, ' ').trim()
    || field.getAttribute('aria-label')
    || field.name
    || 'this field';
};

export const revealListingFieldError = (form, target) => {
  if (!form) return;
  form.querySelectorAll('.field-error-highlight').forEach((node) => node.classList.remove('field-error-highlight'));
  form.querySelectorAll('[aria-invalid="true"]').forEach((node) => node.removeAttribute('aria-invalid'));

  const field = typeof target === 'string'
    ? form.querySelector(`#${escapeSelector(target)}, [name="${escapeSelector(target)}"]`)
    : target;
  if (!field) return;

  field.setAttribute('aria-invalid', 'true');
  const container = field.closest('.form-group') || field.closest('.image-upload-area') || field;
  container.classList.add('field-error-highlight');
  container.scrollIntoView?.({ behavior: 'smooth', block: 'center' });

  const selectControl = field.closest('.searchable-select-wrapper')?.querySelector('.searchable-select__control');
  (selectControl || field).focus?.();
};
