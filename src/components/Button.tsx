import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Link } from 'react-router';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
  fullWidth?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}

interface ButtonLinkProps {
  to: string;
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
  fullWidth?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}

/** Lien de navigation avec l'apparence d'un bouton (ex. « Reprendre »). */
export function ButtonLink({ to, variant = 'primary', size = 'md', fullWidth = false, icon, children }: ButtonLinkProps) {
  const classes = [styles.button, styles[variant], styles[size], fullWidth && styles.fullWidth].filter(Boolean).join(' ');
  return (
    <Link to={to} className={classes}>
      {icon}
      <span>{children}</span>
    </Link>
  );
}

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [styles.button, styles[variant], styles[size], fullWidth && styles.fullWidth, className]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={classes} disabled={disabled === true || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <LoaderCircle className={styles.spinner} aria-hidden /> : icon}
      <span>{children}</span>
    </button>
  );
}
