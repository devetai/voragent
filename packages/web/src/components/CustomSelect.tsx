import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
  hideDisabled?: boolean;
  icon?: ReactNode;
  className?: string;
  id?: string;
}

interface DropdownCoords {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  minWidth: number;
  maxHeight: number;
}

export function CustomSelect<T extends string = string>({
  options,
  value,
  onChange,
  placeholder = 'Chọn một mục...',
  disabled = false,
  searchable,
  searchPlaceholder = 'Tìm kiếm lựa chọn...',
  hideDisabled = false,
  icon,
  className = '',
  id,
}: CustomSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [coords, setCoords] = useState<DropdownCoords | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const visibleBaseOptions = hideDisabled ? options.filter((o) => !o.disabled) : options;
  const isSearchable = searchable ?? visibleBaseOptions.length >= 5;

  const selectedOption =
    visibleBaseOptions.find((o) => o.value === value && !o.disabled) ??
    visibleBaseOptions.find((o) => !o.disabled);

  const filteredOptions = isSearchable && query.trim() !== ''
    ? visibleBaseOptions.filter((o) =>
        o.label.toLowerCase().includes(query.toLowerCase()) ||
        (o.sublabel && o.sublabel.toLowerCase().includes(query.toLowerCase()))
      )
    : visibleBaseOptions;

  // Tính toán vị trí Fixed trong Viewport (Portal to document.body)
  const updateCoords = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;

    const spaceBelow = vh - rect.bottom;
    const spaceAbove = rect.top;
    const openUpwards = spaceBelow < 260 && spaceAbove > spaceBelow;

    const maxHeight = Math.min(340, Math.max(160, openUpwards ? spaceAbove - 16 : spaceBelow - 16));

    let top: number | undefined;
    let bottom: number | undefined;
    if (openUpwards) {
      bottom = Math.max(8, vh - rect.top + 4);
    } else {
      top = Math.max(8, rect.bottom + 4);
    }

    const minWidth = Math.max(rect.width, 320);
    let left: number | undefined;
    let right: number | undefined;

    // Nếu mép phải của trigger gần viền màn hình thì căn theo cạnh phải
    if (rect.left + minWidth > vw - 16 && rect.right > 300) {
      right = Math.max(12, vw - rect.right);
    } else {
      left = Math.max(12, Math.min(rect.left, vw - minWidth - 12));
    }

    setCoords({ top, bottom, left, right, minWidth, maxHeight });
  };

  useEffect(() => {
    if (isOpen) {
      updateCoords();
      if (isSearchable) {
        setTimeout(() => searchInputRef.current?.focus(), 40);
      }
    } else {
      setQuery('');
      setCoords(null);
    }
  }, [isOpen, isSearchable]);

  // Cập nhật vị trí khi cuộn hoặc resize
  useEffect(() => {
    if (!isOpen) return;

    const handleScrollOrResize = () => {
      updateCoords();
    };

    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);

    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isOpen]);

  // Click outside listener (hỗ trợ Portal gắn ngoài document.body)
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current?.contains(target) ||
        triggerRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) {
        return;
      }
      setIsOpen(false);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSelect = (option: SelectOption<T>) => {
    if (disabled || option.disabled) return;
    onChange(option.value);
    setIsOpen(false);
  };

  const renderDropdownPortal = () => {
    if (!isOpen || !coords) return null;

    const style: React.CSSProperties = {
      position: 'fixed',
      zIndex: 99999,
      minWidth: `${coords.minWidth}px`,
      maxWidth: `min(480px, calc(100vw - 24px))`,
      maxHeight: `${coords.maxHeight}px`,
      top: coords.top !== undefined ? `${coords.top}px` : 'auto',
      bottom: coords.bottom !== undefined ? `${coords.bottom}px` : 'auto',
      left: coords.left !== undefined ? `${coords.left}px` : 'auto',
      right: coords.right !== undefined ? `${coords.right}px` : 'auto',
    };

    return createPortal(
      <div
        ref={dropdownRef}
        className="custom-select-dropdown is-portal"
        style={style}
        role="listbox"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
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
        onMouseDown={(e) => e.stopPropagation()}
            />
            {query && (
              <button
                type="button"
                className="custom-select-clear-btn"
                onClick={() => setQuery('')}
                data-tooltip="Xóa tìm kiếm"
              >
                <X size={12} />
              </button>
            )}
          </div>
        )}

        <div
          className="custom-select-options-list"
          style={{ maxHeight: isSearchable ? `${Math.max(100, coords.maxHeight - 48)}px` : `${coords.maxHeight}px` }}
        >
          {filteredOptions.length === 0 ? (
            <div className="custom-select-empty">
              Không tìm thấy lựa chọn khả dụng
            </div>
          ) : (
            filteredOptions.map((opt) => {
              const isSelected = !opt.disabled && selectedOption?.value === opt.value;
              return (
                <div
                  key={opt.value}
                  className={`custom-select-option ${isSelected ? 'selected' : ''} ${opt.disabled ? 'disabled' : ''}`}
                  onClick={() => handleSelect(opt)}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={opt.disabled ? true : undefined}
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
      </div>,
      document.body
    );
  };

  return (
    <div
      ref={containerRef}
      className={`custom-select-container ${disabled ? 'disabled' : ''} ${className}`}
      id={id}
    >
      <button
        ref={triggerRef}
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

      {renderDropdownPortal()}
    </div>
  );
}
