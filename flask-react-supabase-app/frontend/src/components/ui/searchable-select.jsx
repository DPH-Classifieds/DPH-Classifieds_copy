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
    borderRadius: 10,
    borderColor: state.isFocused ? '#4ade80' : '#2a2a2a',
    background: '#1a1a1a',
    boxShadow: state.isFocused ? '0 0 0 3px rgba(74, 222, 128, 0.26)' : 'none',
    '&:hover': {
      borderColor: state.isFocused ? '#4ade80' : 'rgba(74, 222, 128, 0.6)',
    },
  }),
  valueContainer: (base) => ({
    ...base,
    padding: '0 10px',
  }),
  input: (base) => ({
    ...base,
    color: '#ffffff',
    margin: 0,
    padding: 0,
  }),
  placeholder: (base) => ({
    ...base,
    color: '#555555',
  }),
  singleValue: (base) => ({
    ...base,
    color: '#ffffff',
  }),
  indicatorSeparator: () => ({
    display: 'none',
  }),
  dropdownIndicator: (base, state) => ({
    ...base,
    color: state.isFocused ? '#4ade80' : '#8a8a8a',
    '&:hover': {
      color: '#4ade80',
    },
  }),
  clearIndicator: (base) => ({
    ...base,
    color: '#8a8a8a',
    '&:hover': {
      color: '#4ade80',
    },
  }),
  menuPortal: (base) => ({
    ...base,
    zIndex: 9999,
  }),
  menu: (base) => ({
    ...base,
    overflow: 'hidden',
    borderRadius: 10,
    border: '1px solid #2a2a2a',
    background: '#1c1c1c',
    boxShadow: '0 16px 28px rgba(0, 0, 0, 0.35)',
  }),
  menuList: (base) => ({
    ...base,
    padding: 8,
  }),
  option: (base, state) => ({
    ...base,
    borderRadius: 8,
    cursor: state.isDisabled ? 'not-allowed' : 'pointer',
    backgroundColor: state.isSelected
      ? 'rgba(74, 222, 128, 0.15)'
      : state.isFocused
        ? 'rgba(74, 222, 128, 0.08)'
        : 'transparent',
    color: state.isSelected ? '#4ade80' : state.isDisabled ? '#666666' : '#f0f0f0',
    padding: '10px 12px',
  }),
  groupHeading: (base) => ({
    ...base,
    color: '#8a8a8a',
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
        tabIndex={-1}
        autoComplete="off"
        value={value ?? ''}
        onChange={() => {}}
        required={Boolean(required && !selectedOption)}
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
        isSearchable
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
