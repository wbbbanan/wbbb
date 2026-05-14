import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';

interface MarkdownRendererProps { content: string; className?: string; }

/** Render a diff code block with green/red line coloring. */
const DiffBlock = ({ value }: { value: string }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => { void navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }, [value]);

  const lines = value.split('\n');

  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-overlay)]">
      <button onClick={handleCopy} className="absolute right-2 top-2 rounded p-1 text-[var(--text-muted)] opacity-0 transition hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)] group-hover:opacity-100 z-10">
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      <div className="overflow-x-auto p-4">
        <pre className="font-mono text-xs leading-6">
          {lines.map((line, i) => {
            const isAddition = line.startsWith('+') && !line.startsWith('++');
            const isDeletion = line.startsWith('-') && !line.startsWith('--');
            const isHeader = line.startsWith('@@') || line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++');

            let lineClass = 'text-[var(--text-primary)]';
            let bgClass = '';
            if (isAddition) { lineClass = 'text-[#22c55e]'; bgClass = 'bg-[#22c55e]/8'; }
            else if (isDeletion) { lineClass = 'text-[#ef4444]'; bgClass = 'bg-[#ef4444]/8'; }
            else if (isHeader) { lineClass = 'text-[var(--text-muted)]'; }

            return (
              <div key={i} className={`${bgClass} -mx-4 px-4`}>
                <code className={lineClass}>{line || ' '}</code>
              </div>
            );
          })}
        </pre>
      </div>
    </div>
  );
};

const CodeBlock = ({ language, value }: { language: string; value: string }) => {
  if (language === 'diff') return <DiffBlock value={value} />;

  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => { void navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }, [value]);
  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-overlay)]">
      <button onClick={handleCopy} className="absolute right-2 top-2 rounded p-1 text-[var(--text-muted)] opacity-0 transition hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)] group-hover:opacity-100">
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      <SyntaxHighlighter language={language || 'text'} style={oneDark} customStyle={{ margin: 0, padding: '16px', background: 'transparent', fontSize: '12px', lineHeight: '1.6' }} wrapLongLines>{value}</SyntaxHighlighter>
    </div>
  );
};

export const MarkdownRenderer = ({ content, className = '' }: MarkdownRendererProps): JSX.Element => (
  <div className={`markdown-body ${className}`}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code: ({ className: codeClassName, children, ...props }) => {
          const match = /language-(\w+)/.exec(codeClassName || '');
          const value = String(children).replace(/\n$/, '');
          if (match) return <CodeBlock language={match[1]} value={value} />;
          return <code className="rounded bg-[var(--surface-overlay)] px-1 py-0.5 font-mono text-[0.85em] text-[var(--text-primary)]" {...props}>{children}</code>;
        },
        p: ({ children }) => <p className="mb-3 text-sm leading-relaxed text-[var(--text-primary)]">{children}</p>,
        h1: ({ children }) => <h1 className="mb-4 mt-6 text-lg font-semibold text-[var(--text-primary)]">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-3 mt-5 text-base font-semibold text-[var(--text-primary)]">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-2 mt-4 text-sm font-semibold text-[var(--text-primary)]">{children}</h3>,
        ul: ({ children }) => <ul className="mb-3 ml-5 list-disc space-y-1 text-sm text-[var(--text-secondary)]">{children}</ul>,
        ol: ({ children }) => <ol className="mb-3 ml-5 list-decimal space-y-1 text-sm text-[var(--text-secondary)]">{children}</ol>,
        li: ({ children }) => <li className="leading-6">{children}</li>,
        blockquote: ({ children }) => <blockquote className="my-3 border-l border-[var(--border-muted)] pl-4 text-sm text-[var(--text-muted)]">{children}</blockquote>,
        a: ({ href, children }) => <a href={href} className="text-[var(--link)] underline underline-offset-2 hover:opacity-80" target="_blank" rel="noopener noreferrer">{children}</a>,
        table: ({ children }) => <div className="my-3 overflow-x-auto"><table className="w-full text-sm">{children}</table></div>,
        th: ({ children }) => <th className="border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2 text-left font-medium text-[var(--text-secondary)]">{children}</th>,
        td: ({ children }) => <td className="border-b border-[var(--border-subtle)] px-3 py-2 text-[var(--text-muted)]">{children}</td>,
        hr: () => <hr className="my-6 border-[var(--border-subtle)]" />,
      }}
    >{content}</ReactMarkdown>
  </div>
);
