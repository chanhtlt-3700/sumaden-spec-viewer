import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** `<br>` is common in these docs; turn it into a real markdown hard break. */
const prepare = (text: string) =>
  text.replace(/<br\s*\/?>/gi, '  \n').replace(/&nbsp;/gi, ' ');

export function Markdown({ text, className }: { text: string; className?: string }) {
  const source = useMemo(() => prepare(text), [text]);
  return (
    <div className={`md ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="md-table-scroll">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
