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
  const baseClasses = "inline-flex items-center px-4 py-2 rounded-lg text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-offset-2 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200";

  const variantClasses = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90 focus:ring-primary shadow-md hover:shadow-lg",
    secondary: "bg-card border border-border text-foreground hover:bg-muted focus:ring-primary shadow-sm hover:shadow-md"
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