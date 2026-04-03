import type { ReactNode } from 'react';

interface DropdownProps {
  isOpen: boolean;
  children: ReactNode;
  className?: string;
}

export function Dropdown({ isOpen, children, className = '' }: DropdownProps) {
  if (!isOpen) return null;

  return (
    <div
      className={`absolute bottom-full left-0 mb-10 bg-bg border-2 border-border rounded-none shadow-pixel p-4 z-10 ${className}`}
    >
      {children}
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
