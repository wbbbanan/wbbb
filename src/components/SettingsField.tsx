import { controlInputClass, controlTextAreaClass } from '../lib/constants';

export const SettingsField = ({
  label,
  value,
  onChange,
  description,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  description?: string;
  type?: 'text' | 'password';
  placeholder?: string;
}): JSX.Element => (
  <div className="space-y-1.5">
    <label className="text-sm text-[var(--text-secondary)]">{label}</label>
    {description ? <p className="text-2xs text-[var(--text-muted)]">{description}</p> : null}
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={controlInputClass}
    />
  </div>
);

export const SettingsTextArea = ({
  label,
  value,
  onChange,
  description,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  description?: string;
  placeholder?: string;
}): JSX.Element => (
  <div className="space-y-1.5">
    <label className="text-sm text-[var(--text-secondary)]">{label}</label>
    {description ? <p className="text-2xs text-[var(--text-muted)]">{description}</p> : null}
    <textarea
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={`min-h-[120px] font-mono text-xs leading-5 ${controlTextAreaClass}`}
    />
  </div>
);
