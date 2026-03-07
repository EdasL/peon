import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="break-words min-w-0 text-sm leading-tight">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-0.5 last:mb-0">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        ul: ({ children }) => <ul className="list-disc pl-4 mb-0.5 last:mb-0 space-y-0">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-4 mb-0.5 last:mb-0 space-y-0">{children}</ol>,
        li: ({ children }) => <li className="leading-tight">{children}</li>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:text-primary/80 break-all">
            {children}
          </a>
        ),
        code: ({ className, children }) => {
          const isBlock = className?.includes("language-")
          if (isBlock) {
            return (
              <pre className="my-1 rounded-sm bg-[#1A1916] p-2.5 overflow-x-auto max-w-full min-w-0">
                <code className="text-xs font-mono text-[#F7F6F2]">{children}</code>
              </pre>
            )
          }
          return (
            <code className="rounded-sm bg-muted px-1.5 py-0.5 text-xs font-mono">
              {children}
            </code>
          )
        },
        pre: ({ children }) => <>{children}</>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-primary/30 pl-3 my-1 text-muted-foreground italic">
            {children}
          </blockquote>
        ),
        h1: ({ children }) => <h1 className="text-base font-bold mb-0.5 mt-1">{children}</h1>,
        h2: ({ children }) => <h2 className="text-sm font-bold mb-0.5 mt-1">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold mb-0.5 mt-1">{children}</h3>,
      }}
    >
      {content}
    </ReactMarkdown>
    </div>
  )
}
