import type { ReactNode } from 'react';

interface DropdownProps {
  isOpen: boolean;
  children: ReactNode;
  className?: string;
  direction?: 'up' | 'down';
  maxHeight?: number;
}

export function Dropdown({
  isOpen,
  children,
  className = '',
  direction = 'up',
  maxHeight,
}: DropdownProps) {
  if (!isOpen) return null;

  const positionClass =
    direction === 'down' ? 'top-full left-0 pt-10 z-30' : 'bottom-full left-0 pb-10 z-30';

  return (
    <div className={`absolute ${positionClass}`}>
      <div
        className={`bg-bg border-2 border-border rounded-none shadow-pixel p-4 ${maxHeight ? 'overflow-y-auto pixel-scrollbar' : ''} ${className}`}
        style={maxHeight ? { maxHeight } : undefined}
      >
        {children}
      </div>
    </div>
  );
}

interface DropdownItemProps {
  onClick: () => void;
  children: ReactNode;
  className?: string;
}

export function DropdownItem({ onClick, children, className = '' }: DropdownItemProps) {
  return (
    <button
      onClick={onClick}
      className={`block w-full text-left py-2 px-12 bg-transparent border-none rounded-none cursor-pointer whitespace-nowrap hover:bg-btn-bg ${className}`}
    >
      {children}
    </button>
  );
}
