import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import styles from './Field.module.css';

interface FieldShellProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  optional?: boolean;
  htmlFor?: string;
  children: ReactNode;
}

/** Label + hint + error scaffolding shared by every form control. */
export function FieldShell({
  label,
  hint,
  error,
  required,
  optional,
  htmlFor,
  children,
}: FieldShellProps) {
  return (
    <div className={styles.field}>
      {(label || optional) && (
        <div className={styles.labelRow}>
          {label && (
            <label className={styles.label} htmlFor={htmlFor}>
              {label}
              {required && (
                <span className={styles.required} aria-hidden="true">
                  *
                </span>
              )}
            </label>
          )}
          {optional && <span className={styles.optional}>optional</span>}
        </div>
      )}
      {children}
      {hint && !error && <p className={styles.hint}>{hint}</p>}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  mono?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, optional, mono, id, required, className, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <FieldShell
      {...(label !== undefined ? { label } : {})}
      {...(hint !== undefined ? { hint } : {})}
      {...(error !== undefined ? { error } : {})}
      {...(required !== undefined ? { required } : {})}
      {...(optional !== undefined ? { optional } : {})}
      htmlFor={inputId}
    >
      <input
        ref={ref}
        id={inputId}
        required={required}
        aria-invalid={error ? true : undefined}
        className={[styles.control, mono ? styles.mono : '', error ? styles.invalid : '', className ?? '']
          .filter(Boolean)
          .join(' ')}
        {...rest}
      />
    </FieldShell>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  mono?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, optional, mono, id, required, className, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <FieldShell
      {...(label !== undefined ? { label } : {})}
      {...(hint !== undefined ? { hint } : {})}
      {...(error !== undefined ? { error } : {})}
      {...(required !== undefined ? { required } : {})}
      {...(optional !== undefined ? { optional } : {})}
      htmlFor={inputId}
    >
      <textarea
        ref={ref}
        id={inputId}
        required={required}
        aria-invalid={error ? true : undefined}
        className={[styles.textarea, mono ? styles.mono : '', error ? styles.invalid : '', className ?? '']
          .filter(Boolean)
          .join(' ')}
        {...rest}
      />
    </FieldShell>
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, optional, id, required, className, children, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <FieldShell
      {...(label !== undefined ? { label } : {})}
      {...(hint !== undefined ? { hint } : {})}
      {...(error !== undefined ? { error } : {})}
      {...(required !== undefined ? { required } : {})}
      {...(optional !== undefined ? { optional } : {})}
      htmlFor={inputId}
    >
      <select
        ref={ref}
        id={inputId}
        required={required}
        aria-invalid={error ? true : undefined}
        className={[styles.select, error ? styles.invalid : '', className ?? ''].filter(Boolean).join(' ')}
        {...rest}
      >
        {children}
      </select>
    </FieldShell>
  );
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  hint?: ReactNode;
}

export function Checkbox({ label, hint, id, className, ...rest }: CheckboxProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <label className={styles.checkboxRow} htmlFor={inputId}>
      <input
        type="checkbox"
        id={inputId}
        className={[styles.checkbox, className ?? ''].filter(Boolean).join(' ')}
        {...rest}
      />
      <span className={styles.checkboxLabel}>
        {label}
        {hint && <span className={styles.checkboxHint}>{hint}</span>}
      </span>
    </label>
  );
}
