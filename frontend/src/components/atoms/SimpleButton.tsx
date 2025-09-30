'use client';

import React from 'react';
import { LucideIcon } from 'lucide-react';

interface SimpleButtonProps {
  onClick: () => void;
  disabled?: boolean;
  icon?: LucideIcon;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
  loading?: boolean;
}

const SimpleButton = React.memo<SimpleButtonProps>(({
  onClick,
  disabled = false,
  icon: Icon,
  children,
  variant = 'secondary',
  loading = false
}) => {
  const baseClasses = "inline-flex items-center px-3 py-2 border rounded-md shadow-sm text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50";

  const variantClasses = {
    primary: "border-blue-500 text-white bg-blue-600 hover:bg-blue-700 focus:ring-blue-500",
    secondary: "border-gray-300 text-gray-700 bg-white hover:bg-gray-50 focus:ring-blue-500"
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`${baseClasses} ${variantClasses[variant]}`}
    >
      {Icon && (
        <Icon className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
      )}
      {children}
    </button>
  );
});

SimpleButton.displayName = 'SimpleButton';

export default SimpleButton;