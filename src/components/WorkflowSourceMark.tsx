export type WorkflowSourceMarkKind = 'system' | 'opencode' | 'claude';

const sizeClasses: Record<'xs' | 'sm' | 'md' | 'lg', string> = {
  xs: 'h-3 w-3',
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-5 w-5',
};

const OpenCodeMark = (): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-full w-full" aria-hidden="true">
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M3.5 3.5h17v17h-17zm4.9 4.9v7.2h7.2V8.4z"
    />
  </svg>
);

const ClaudeMark = (): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" className="h-full w-full" aria-hidden="true">
    <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M12 4.1v3.7" />
      <path d="M12 16.2v3.7" />
      <path d="M4.1 12h3.7" />
      <path d="M16.2 12h3.7" />
      <path d="M6.4 6.4l2.6 2.6" />
      <path d="M15 15l2.6 2.6" />
      <path d="M17.6 6.4L15 9" />
      <path d="M9 15l-2.6 2.6" />
    </g>
  </svg>
);

const SystemMark = (): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" className="h-full w-full" aria-hidden="true">
    <g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="5.5" r="1.9" />
      <circle cx="18" cy="12" r="1.9" />
      <circle cx="6" cy="18.5" r="1.9" />
      <path d="M7.9 6.6v10.8" />
      <path d="M7.9 7.1 16.1 11" />
      <path d="M7.9 16.9 16.1 13" />
    </g>
  </svg>
);

export const WorkflowSourceMark = ({
  source,
  size = 'sm',
  className = '',
}: {
  source: WorkflowSourceMarkKind;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}): JSX.Element => {
  const normalizedClassName = `${sizeClasses[size]} inline-flex shrink-0 items-center justify-center ${className}`.trim();

  return (
    <span className={normalizedClassName} aria-hidden="true">
      {source === 'opencode' ? <OpenCodeMark /> : null}
      {source === 'claude' ? <ClaudeMark /> : null}
      {source === 'system' ? <SystemMark /> : null}
    </span>
  );
};