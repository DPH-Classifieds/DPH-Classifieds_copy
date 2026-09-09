import React, { useMemo, useRef } from 'react';
import Select from 'react-select';
import './searchable-select.css';

const textFromChildren = (children) =>
  React.Children.toArray(children)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') {
        return String(child);
      }
      if (React.isValidElement(child)) {
        return textFromChildren(child.props.children);
      }
      return '';
    })
    .join('')
    .trim();

const parseOptions = (children) =>
  React.Children.toArray(children).flatMap((child) => {
    if (!React.isValidElement(child)) {
      return [];
    }

    if (child.type === 'optgroup') {
      return [
        {
          label: child.props.label,
          options: parseOptions(child.props.children),
        },
      ];
    }

    if (child.type === 'option') {
      return [
        {
          value: child.props.value ?? '',
          label: textFromChildren(child.props.children),
          isDisabled: Boolean(child.props.disabled),
        },
      ];
    }

    return [];
  });

const flattenOptions = (options) =>
  options.flatMap((option) => (Array.isArray(option.options) ? option.options : option));

const sharedStyles = {
  control: (base, state) => ({
    ...base,
    minHeight: 44,
    borderRadius: 8,
    borderColor: 'var(--ex-line-strong)',
    background: 'var(--ex-input-bg)',
    boxShadow: 'none',
    '&:hover': {
      borderColor: 'var(--ex-primary)',
    },
  }),
  valueContainer: (base) => ({
    ...base,
    padding: '0 10px',
  }),
  input: (base) => ({
    ...base,
    color: 'var(--ex-text)',
    margin: 0,
    padding: 0,
  }),
  placeholder: (base) => ({
    ...base,
    color: 'var(--ex-text-muted)',
  }),
  singleValue: (base) => ({
    ...base,
    color: 'var(--ex-text)',
  }),
  indicatorSeparator: () => ({
    display: 'none',
  }),
  dropdownIndicator: (base, state) => ({
    ...base,
    color: 'var(--ex-text-muted)',
    '&:hover': {
      color: 'var(--ex-text)',
    },
  }),
  clearIndicator: (base) => ({
    ...base,
    color: 'var(--ex-text-muted)',
    '&:hover': {
      color: 'var(--ex-text)',
    },
  }),
  menuPortal: (base) => ({
    ...base,
    zIndex: 9999,
  }),
  menu: (base) => ({
    ...base,
    overflow: 'hidden',
    borderRadius: 8,
    border: '1px solid var(--ex-line-strong)',
    background: 'var(--ex-surface)',
    boxShadow: '0 16px 28px rgba(0, 0, 0, 0.18)',
  }),
  menuList: (base) => ({
    ...base,
    padding: 8,
  }),
  option: (base, state) => ({
    ...base,
    borderRadius: 6,
    cursor: state.isDisabled ? 'not-allowed' : 'pointer',
    backgroundColor: state.isSelected
      ? 'var(--ex-brand-subtle-bg)'
      : state.isFocused
        ? 'var(--ex-surface-low)'
        : 'transparent',
    color: state.isSelected ? 'var(--ex-primary)' : state.isDisabled ? 'var(--ex-text-muted)' : 'var(--ex-text)',
    padding: '10px 12px',
  }),
  groupHeading: (base) => ({
    ...base,
    color: 'var(--ex-text-muted)',
    fontSize: '0.72rem',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    padding: '6px 10px 4px',
  }),
};

const SearchableSelect = ({
  children,
  name,
  value,
  onChange,
  placeholder,
  isSearchable = true,
  isDisabled,
  disabled,
  required,
  className,
  id,
  ...props
}) => {
  const selectRef = useRef(null);
  const options = useMemo(() => parseOptions(children), [children]);
  const flatOptions = useMemo(() => flattenOptions(options), [options]);
  const selectedOption =
    flatOptions.find((option) => String(option.value) === String(value ?? '')) || null;
  // `<option value="">Select Make</option>` is a placeholder, not an answer.
  // Counting it as a selection switched `required` off on every dropdown in
  // every posting form, so nothing was ever validated.
  const hasRealSelection = Boolean(selectedOption && String(selectedOption.value) !== '');

  const derivedPlaceholder =
    placeholder ||
    flatOptions.find((option) => option.value === '')?.label ||
    'Select option';

  const focusVisibleSelect = () => {
    if (selectRef.current && typeof selectRef.current.focus === 'function') {
      selectRef.current.focus();
    }
  };

  return (
    <div className={`searchable-select-wrapper ${className || ''}`}>
      <input
        data-field-id={id || undefined}
        tabIndex={-1}
        autoComplete="off"
        value={value ?? ''}
        onChange={() => {}}
        required={Boolean(required && !hasRealSelection)}
        className="searchable-select-proxy"
        onFocus={(event) => {
          event.target.blur();
          focusVisibleSelect();
        }}
        onInvalid={(event) => {
          event.preventDefault();
          focusVisibleSelect();
        }}
      />
      <Select
        ref={selectRef}
        inputId={id}
        name={name}
        classNamePrefix="searchable-select"
        options={options}
        value={selectedOption}
        isDisabled={isDisabled ?? disabled}
        isSearchable={Boolean(isSearchable)}
        placeholder={derivedPlaceholder}
        styles={sharedStyles}
        menuPortalTarget={typeof document !== 'undefined' ? document.body : null}
        onChange={(nextOption) => {
          const nextValue = nextOption?.value ?? '';
          if (typeof onChange === 'function') {
            onChange({
              target: {
                name,
                value: nextValue,
              },
            });
          }
        }}
        {...props}
      />
    </div>
  );
};

export default SearchableSelect;
