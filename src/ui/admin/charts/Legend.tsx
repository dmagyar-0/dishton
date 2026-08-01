export type LegendItem = {
  key: string;
  label: string;
  color: string;
  shape?: 'line' | 'rect';
};

// A legend is always present for >=2 series (never for one -- the chart
// title already names the single series). Swatches, not colored text: text
// stays in text tokens everywhere else in the chart, per marks-and-anatomy.md.
export function Legend({ items }: { items: LegendItem[] }) {
  if (items.length < 2) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-ink-soft mb-2">
      {items.map((item) => (
        <li key={item.key} className="inline-flex items-center gap-1.5">
          {item.shape === 'line' ? (
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-4 rounded-full"
              style={{ backgroundColor: item.color }}
            />
          ) : (
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 rounded-[3px]"
              style={{ backgroundColor: item.color }}
            />
          )}
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
