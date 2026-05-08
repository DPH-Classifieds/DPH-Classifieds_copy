import React, { useState, useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import '../../styles/SearchBar.css';

const SearchBar = ({
  value = '',
  onChange,
  onSubmit,
  placeholder = 'Search cars, parts, plates, bikes...',
  className = '',
  autoFocus = false,
  size = 'default',
}) => {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (onSubmit) onSubmit(value);
  };

  const handleClear = () => {
    onChange('');
    inputRef.current?.focus();
  };

  return (
    <form
      className={`search-bar ${size === 'large' ? 'search-bar--large' : ''} ${focused ? 'search-bar--focused' : ''} ${className}`}
      onSubmit={handleSubmit}
      role="search">
      <Search className="search-bar__icon" size={size === 'large' ? 20 : 16} />
      <input
        ref={inputRef}
        type="text"
        className="search-bar__input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        aria-label="Search listings"
      />
      {value && (
        <button type="button" className="search-bar__clear" onClick={handleClear} aria-label="Clear search">
          <X size={14} />
        </button>
      )}
    </form>
  );
};

export default SearchBar;
