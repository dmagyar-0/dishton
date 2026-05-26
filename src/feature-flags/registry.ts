// Single source of truth list mirroring docs/15-roadmap-and-flags.md.
// CI compares this to the table in the doc; mismatches fail the build.
//
// FLAG: keep this in lockstep with the doc table.

export type FlagTransport = 'build-time' | 'runtime';

export type FlagDefinition = {
  key: string;
  transport: FlagTransport;
  envVar?: string;
  description: string;
  ownerDoc: string;
};

export const FLAGS: FlagDefinition[] = [
  {
    key: 'google_auth',
    transport: 'build-time',
    envVar: 'VITE_FEATURE_GOOGLE_AUTH',
    description: 'Show the "Continue with Google" button on /auth/login.',
    ownerDoc: 'docs/05-auth-and-households.md',
  },
  {
    key: 'translation_cache',
    transport: 'build-time',
    envVar: 'VITE_FEATURE_TRANSLATION_CACHE',
    description: 'Expose the language toggle and write recipe_translations.',
    ownerDoc: 'docs/06-recipe-domain.md',
  },
  {
    key: 'follows_enabled',
    transport: 'runtime',
    description: 'Allow inserting into app.follows and reading the /following list.',
    ownerDoc: 'docs/05-auth-and-households.md',
  },
  {
    key: 'public_household_pages',
    transport: 'runtime',
    description: 'v2 placeholder; always off in MVP and v1.',
    ownerDoc: 'docs/15-roadmap-and-flags.md',
  },
];
