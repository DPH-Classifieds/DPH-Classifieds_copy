import React, { useMemo } from 'react';
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
    minHeight: 54,
    borderRadius: 16,
    borderColor: state.isFocused ? 'rgba(139, 214, 180, 0.38)' : 'rgba(148, 218, 153, 0.16)',
    background: 'rgba(244, 251, 245, 0.05)',
    boxShadow: state.isFocused ? '0 0 0 4px rgba(139, 214, 180, 0.12)' : 'none',
    '&:hover': {
      borderColor: 'rgba(139, 214, 180, 0.28)',
    },
  }),
  valueContainer: (base) => ({
    ...base,
    padding: '0 14px',
  }),
  input: (base) => ({
    ...base,
    color: '#f7fcf7',
    margin: 0,
    padding: 0,
  }),
  placeholder: (base) => ({
    ...base,
    color: 'rgba(232, 242, 233, 0.46)',
  }),
  singleValue: (base) => ({
    ...base,
    color: '#f7fcf7',
  }),
  indicatorSeparator: () => ({
    display: 'none',
  }),
  dropdownIndicator: (base, state) => ({
    ...base,
    color: state.isFocused ? '#8bd6b4' : 'rgba(232, 242, 233, 0.52)',
    '&:hover': {
      color: '#8bd6b4',
    },
  }),
  clearIndicator: (base) => ({
    ...base,
    color: 'rgba(232, 242, 233, 0.52)',
    '&:hover': {
      color: '#ffffff',
    },
  }),
  menuPortal: (base) => ({
    ...base,
    zIndex: 9999,
  }),
  menu: (base) => ({
    ...base,
    overflow: 'hidden',
    borderRadius: 18,
    border: '1px solid rgba(148, 218, 153, 0.14)',
    background:
      'linear-gradient(180deg, rgba(12, 28, 19, 0.98) 0%, rgba(7, 15, 10, 0.99) 100%)',
    boxShadow: '0 22px 42px rgba(0, 0, 0, 0.28)',
  }),
  menuList: (base) => ({
    ...base,
    padding: 8,
  }),
  option: (base, state) => ({
    ...base,
    borderRadius: 12,
    cursor: state.isDisabled ? 'not-allowed' : 'pointer',
    backgroundColor: state.isSelected
      ? 'rgba(11, 107, 76, 0.92)'
      : state.isFocused
        ? 'rgba(255, 255, 255, 0.06)'
        : 'transparent',
    color: state.isSelected ? '#ffffff' : state.isDisabled ? 'rgba(226, 239, 229, 0.34)' : '#eef7ef',
    padding: '12px 14px',
  }),
  groupHeading: (base) => ({
    ...base,
    color: 'rgba(139, 214, 180, 0.72)',
    fontSize: '0.72rem',
    fontWeight: 800,
    letterSpacing: '0.12em',
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
  const options = useMemo(() => parseOptions(children), [children]);
  const flatOptions = useMemo(() => flattenOptions(options), [options]);
  const selectedOption =
    flatOptions.find((option) => String(option.value) === String(value ?? '')) || null;

  const derivedPlaceholder =
    placeholder ||
    flatOptions.find((option) => option.value === '')?.label ||
    'Select option';

  return (
    <div className={`searchable-select-wrapper ${className || ''}`}>
      <input
        tabIndex={-1}
        autoComplete="off"
        value={value ?? ''}
        onChange={() => {}}
        required={required}
        className="searchable-select-proxy"
        aria-hidden="true"
      />
      <Select
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
