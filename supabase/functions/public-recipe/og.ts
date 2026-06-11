// Builds the 1200x630 OG card as a plain React-shaped element tree (Satori
// accepts {type, props} objects — no React import needed). Editorial Pantry
// palette: paper #f5efe3, ink #2a1a2c, saffron #e08a1a.

export type OgElement = {
  type: string;
  props: Record<string, unknown> & { children?: unknown };
};

function el(
  type: string,
  props: Record<string, unknown>,
  ...children: (OgElement | string)[]
): OgElement {
  return {
    type,
    props: { ...props, children: children.length === 1 ? children[0] : children },
  };
}

export type OgCardData = {
  title: string;
  householdName: string;
  metaLine: string;
  // Data URI (or https URL) for the hero photo; null renders the text-only layout.
  heroSrc: string | null;
};

export function buildOgElement(data: OgCardData): OgElement {
  const textPane = el(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        flexGrow: 1,
        flexShrink: 1,
        padding: '56px 60px',
      },
    },
    el(
      'div',
      { style: { display: 'flex', flexDirection: 'column' } },
      el(
        'div',
        {
          style: {
            fontSize: 26,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: '#e08a1a',
          },
        },
        `From ${data.householdName}`,
      ),
      el(
        'div',
        {
          style: {
            fontSize: data.title.length > 60 ? 52 : 68,
            lineHeight: 1.1,
            color: '#2a1a2c',
            marginTop: 24,
            fontWeight: 600,
          },
        },
        data.title,
      ),
      el('div', { style: { fontSize: 30, color: '#6b5a6e', marginTop: 28 } }, data.metaLine),
    ),
    el(
      'div',
      { style: { display: 'flex', alignItems: 'center' } },
      el(
        'div',
        {
          style: {
            fontSize: 34,
            color: '#2a1a2c',
            fontWeight: 600,
            borderBottom: '4px solid #e08a1a',
            paddingBottom: 4,
          },
        },
        'Dishton',
      ),
    ),
  );

  const children: OgElement[] = [textPane];
  if (data.heroSrc) {
    children.push(
      el('img', {
        src: data.heroSrc,
        width: 480,
        height: 630,
        style: { width: 480, height: 630, objectFit: 'cover', flexShrink: 0 },
      }),
    );
  }

  return el(
    'div',
    {
      style: {
        width: 1200,
        height: 630,
        display: 'flex',
        flexDirection: 'row',
        backgroundColor: '#f5efe3',
      },
    },
    ...children,
  );
}
