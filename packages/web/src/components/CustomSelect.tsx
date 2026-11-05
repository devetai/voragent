import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  sublabel?: string;
  icon?: ReactNode;
  badge?: string;
  badgeType?: 'warn' | 'success' | 'info' | 'default';
  disabled?: boolean;
}

export interface CustomSelectProps<T extends string = string> {
  options: SelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  icon?: ReactNode;
  className?: string;
  id?: string;
}

export function CustomSelect<T extends string = string>({
  options,
  value,
  onChange,
  placeholder = 'Chọn một mục...',
  disabled = false,
  searchable,
  searchPlaceholder = 'Tìm kiếm lựa chọn...',
  icon,
  className = '',
  id,
}: CustomSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Mặc định searchable nếu danh sách >= 5 mục
  const isSearchable = searchable ?? options.length >= 5;

  const selectedOption = options.find((o) => o.value === value);

  // Lọc options theo query tìm kiếm
  const filteredOptions = isSearchable && query.trim() !== ''
    ? options.filter((o) =>
        o.label.toLowerCase().includes(query.toLowerCase()) ||
        (o.sublabel && o.sublabel.toLowerCase().includes(query.toLowerCase()))
      )
    : options;

  // Tự động focus vào ô search khi mở menu
  useEffect(() => {
    if (isOpen && isSearchable && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
    if (!isOpen) {
      setQuery('');
    }
  }, [isOpen, isSearchable]);

  // Click outside listener để đóng dropdown
  useEffect(() => {
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handlePointerDown);
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSelect = (option: SelectOption<T>) => {
    if (option.disabled) return;
    onChange(option.value);
    setIsOpen(false);
  };

  return (
    <div
      ref={containerRef}
      className={`custom-select-container ${disabled ? 'disabled' : ''} ${className}`}
      id={id}
    >
      {/* Nút kích hoạt Dropdown (Trigger Button) */}
      <button
        type="button"
        className={`custom-select-trigger ${isOpen ? 'active' : ''}`}
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <div className="custom-select-trigger-content">
          {selectedOption?.icon ? (
            <span className="custom-select-icon">{selectedOption.icon}</span>
          ) : icon ? (
            <span className="custom-select-icon">{icon}</span>
          ) : null}

          <span className={`custom-select-label ${!selectedOption ? 'placeholder' : ''}`}>
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </div>

        <ChevronDown
          size={16}
          className={`custom-select-arrow ${isOpen ? 'rotated' : ''}`}
        />
      </button>

      {/* Menu thả xuống (Floating Dropdown Menu) */}
      {isOpen && (
        <div className="custom-select-dropdown" role="listbox">
          {/* Ô tìm kiếm nhanh nội bộ nếu nhiều lựa chọn */}
          {isSearchable && (
            <div className="custom-select-search-box">
              <Search size={14} className="custom-select-search-icon" />
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="custom-select-search-input"
                onClick={(e) => e.stopPropagation()}
              />
              {query && (
                <button
                  type="button"
                  className="custom-select-clear-btn"
                  onClick={() => setQuery('')}
                  title="Xóa tìm kiếm"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )}

          {/* Danh sách các options */}
          <div className="custom-select-options-list">
            {filteredOptions.length === 0 ? (
              <div className="custom-select-empty">
                Không tìm thấy lựa chọn phù hợp
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <div
                    key={opt.value}
                    className={`custom-select-option ${isSelected ? 'selected' : ''} ${opt.disabled ? 'disabled' : ''}`}
                    onClick={() => handleSelect(opt)}
                    role="option"
                    aria-selected={isSelected}
                  >
                    <div className="custom-select-option-body">
                      {opt.icon && <span className="custom-select-option-icon">{opt.icon}</span>}
                      <div className="custom-select-option-text">
                        <div className="custom-select-option-title-row">
                          <span className="custom-select-option-title">{opt.label}</span>
                          {opt.badge && (
                            <span className={`custom-select-badge ${opt.badgeType || 'default'}`}>
                              {opt.badge}
                            </span>
                          )}
                        </div>
                        {opt.sublabel && (
                          <span className="custom-select-option-sublabel">{opt.sublabel}</span>
                        )}
                      </div>
                    </div>

                    {isSelected && (
                      <Check size={15} className="custom-select-check-icon" />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
