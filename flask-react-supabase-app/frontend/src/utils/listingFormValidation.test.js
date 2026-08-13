import { fieldLabel, firstMissingRequiredField, revealListingFieldError } from './listingFormValidation';

describe('listing form validation', () => {
  test('reveals the first missing required listing field', () => {
    document.body.innerHTML = `
      <form><div class="form-group"><label for="make">Make *</label><input id="make" name="make" required></div>
      <div class="form-group"><label for="price">Price *</label><input id="price" required value="500"></div></form>`;
    const form = document.querySelector('form');
    const missing = firstMissingRequiredField(form);
    expect(missing.id).toBe('make');
    expect(fieldLabel(form, missing)).toBe('Make');
    revealListingFieldError(form, missing);
    expect(missing).toHaveAttribute('aria-invalid', 'true');
    expect(missing.closest('.form-group')).toHaveClass('field-error-highlight');
  });
});
