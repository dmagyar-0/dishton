// Pure OG meta-document builder for crawler traffic. Every interpolated value
// is user-controlled (recipe titles/descriptions) — escape all of it.

export function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export type MetaHtmlOpts = {
  title: string;
  description: string;
  canonicalUrl: string;
  ogImageUrl: string;
};

export function buildMetaHtml(opts: MetaHtmlOpts): string {
  const title = escapeHtml(opts.title);
  const description = escapeHtml(opts.description);
  const canonical = escapeHtml(opts.canonicalUrl);
  const image = escapeHtml(opts.ogImageUrl);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title} — Dishton</title>
<meta name="description" content="${description}" />
<meta name="robots" content="noindex" />
<link rel="canonical" href="${canonical}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="Dishton" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${description}" />
<meta property="og:url" content="${canonical}" />
<meta property="og:image" content="${image}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${description}" />
<meta name="twitter:image" content="${image}" />
<meta http-equiv="refresh" content="0;url=${canonical}" />
</head>
<body>
<p><a href="${canonical}">${title}</a></p>
</body>
</html>
`;
}
