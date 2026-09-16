import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Signup from './Signup';

jest.mock('../utils/authService', () => ({
  saveAuthData: jest.fn(),
  setAuthHeader: jest.fn(),
}));
jest.mock('../utils/supabaseClient', () => ({
  signInWithGoogle: jest.fn(),
}));
jest.mock('../utils/usernameAvailability', () => ({
  checkUsernameAvailability: jest.fn(() => Promise.resolve({ available: true, message: '' })),
  sanitizeUsernameInput: (value) => value,
  getUsernameValidationError: jest.fn(() => null),
}));
jest.mock('../utils/dealerDocumentExtractor', () => ({
  extractFieldsFromFile: jest.fn(),
}));

const renderSignup = () => render(
  <MemoryRouter>
    <Signup />
  </MemoryRouter>
);

test('dealer signup removes internal OCR wording and highlights invalid phone input', () => {
  const { container } = renderSignup();

  fireEvent.click(screen.getByLabelText(/Yes - Dealer\/Business/i));
  expect(container.textContent).not.toContain('PaddleOCR checks both automatically');

  fireEvent.submit(container.querySelector('form'));

  const phone = container.querySelector('#phone');
  expect(phone).toHaveClass('error-input');
  expect(container.querySelector('#phone-error')).toHaveTextContent('Phone number is required');
  expect(container.querySelector('#legalBusinessName-error')).toHaveTextContent('Legal business name is required');
  expect(container.querySelector('#trn-error')).toHaveTextContent('TRN is required');
});
