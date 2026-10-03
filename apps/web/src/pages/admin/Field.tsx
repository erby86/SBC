import type { ReactNode } from 'react';

/** Label + control + the api's error for this field. */
export function Field({
  label,
  error,
  children,
  hint,
}: {
  label: string;
  error?: string | undefined;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className={`field${error ? ' bad' : ''}`}>
      <span className="flabel">{label}</span>
      {children}
      {hint && !error && <small className="fhint">{hint}</small>}
      {error && <small className="ferr">{error}</small>}
    </label>
  );
}

export const val = (s: string) => (s.trim() === '' ? null : s.trim());
export const num = (s: string) => (s.trim() === '' ? null : Number(s));
