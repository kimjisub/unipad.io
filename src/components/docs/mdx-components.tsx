import type { MDXComponents } from 'mdx/types';

function Callout({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/30 p-4 text-sm not-prose">
      <p className="font-semibold text-foreground mb-2">{title}</p>
      <div className="text-muted-foreground [&_ul]:list-disc [&_ul]:list-inside [&_ul]:space-y-1 [&_code]:text-xs [&_code]:bg-muted/50 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded">
        {children}
      </div>
    </div>
  );
}

export const mdxComponents: MDXComponents = {
  Callout,
};
