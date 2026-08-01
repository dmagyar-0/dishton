import type { ReactNode } from 'react';

export type DataTableColumn = {
  key: string;
  label: string;
  align?: 'left' | 'right';
};

export type DataTableProps = {
  columns: DataTableColumn[];
  rows: Array<Record<string, ReactNode>>;
  getRowKey: (row: Record<string, ReactNode>, index: number) => string;
  emptyLabel?: string;
};

// The WCAG-clean twin of every chart on this dashboard: the same rows, in a
// plain table, reachable without hovering anything. Numeric columns get
// tabular-nums (unlike the stat-tile hero values) because these ARE columns
// of numbers that must align vertically.
export function DataTable({ columns, rows, getRowKey, emptyLabel }: DataTableProps) {
  if (rows.length === 0) {
    return <p className="text-ink-soft text-sm py-4">{emptyLabel ?? '—'}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse min-w-[32rem]">
        <thead>
          <tr className="border-b border-cream-line text-left text-ink-soft">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={col.align === 'right' ? 'py-2 pr-2 text-right' : 'py-2 pr-2'}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={getRowKey(row, i)} className="border-b border-cream-line/60 text-ink">
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={
                    col.align === 'right'
                      ? 'py-1.5 pr-2 text-right [font-variant-numeric:tabular-nums]'
                      : 'py-1.5 pr-2'
                  }
                >
                  {row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
