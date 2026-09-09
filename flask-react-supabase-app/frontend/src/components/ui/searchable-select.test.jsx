import React from 'react';
import { render, screen } from '@testing-library/react';
import SearchableSelect from './searchable-select';
import { fieldLabel, firstMissingRequiredField } from '../../utils/listingFormValidation';

// The posting forms validate through the hidden proxy input, not react-select.
const proxy = () => document.querySelector('.searchable-select-proxy');

const renderSelect = (value) => render(
  <form>
    <div className="form-group">
      <label htmlFor="car_manufacturer">Make *</label>
      <SearchableSelect id="car_manufacturer" name="car_manufacturer" value={value} onChange={() => {}} required>
        <option value="">Select Make</option>
        <option value="Toyota">Toyota</option>
      </SearchableSelect>
    </div>
  </form>,
);

describe('SearchableSelect required enforcement', () => {
  test('an unselected dropdown is required even though a blank placeholder option exists', () => {
    renderSelect('');
    expect(proxy()).toBeRequired();
    const form = document.querySelector('form');
    expect(firstMissingRequiredField(form)).toBe(proxy());
    expect(fieldLabel(form, proxy())).toBe('Make');
  });

  test('a real selection clears the requirement', () => {
    renderSelect('Toyota');
    expect(proxy()).not.toBeRequired();
    expect(firstMissingRequiredField(document.querySelector('form'))).toBeNull();
    expect(screen.getByText('Toyota')).toBeInTheDocument();
  });
});
