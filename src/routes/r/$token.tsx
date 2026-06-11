// Public, unauthenticated share landing route. No auth guard by design: the
// token in the URL is the credential. The root shell skips the AppShell for
// /r/ routes; PublicRecipePage brings its own minimal frame.

import { PublicRecipePage } from '@/ui/recipe/PublicRecipePage';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

const Search = z.object({
  servings: z.coerce.number().int().positive().optional(),
  units: z.enum(['metric', 'imperial']).optional(),
});

export const Route = createFileRoute('/r/$token')({
  validateSearch: Search,
  component: PublicRecipeRoute,
});

function PublicRecipeRoute() {
  const { token } = Route.useParams();
  const search = Route.useSearch();
  const nav = useNavigate({ from: Route.fullPath });

  return (
    <PublicRecipePage
      token={token}
      servings={search.servings}
      units={search.units}
      onServingsChange={(servings) =>
        nav({ to: '.', search: (prev) => ({ ...prev, servings }), resetScroll: false })
      }
      onUnitsChange={(units) =>
        nav({ to: '.', search: (prev) => ({ ...prev, units }), resetScroll: false })
      }
    />
  );
}
