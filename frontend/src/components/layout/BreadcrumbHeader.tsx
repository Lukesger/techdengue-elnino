import React from 'react';

export function BreadcrumbHeader({
  title,
  items,
}: {
  title?: string;
  items?: Array<{ label: string; href?: string }>;
}) {
  return (
    <div className="mb-4">
      {items?.length ? (
        <nav className="mb-1 text-xs text-slate-500">
          {items.map((it, i) => (
            <span key={`${it.label}-${i}`}>
              {i > 0 ? ' / ' : ''}
              {it.label}
            </span>
          ))}
        </nav>
      ) : null}
      {title ? <h1 className="text-2xl font-semibold text-slate-800">{title}</h1> : null}
    </div>
  );
}
