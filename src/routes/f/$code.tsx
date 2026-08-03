// Public, unauthenticated follow-link landing route. No auth guard by design:
// the code in the URL is the credential, exactly as /r/$token treats its
// token. The root shell skips the AppShell for /f/ routes; FollowLinkPage
// brings its own minimal frame.

import { FollowLinkPage } from '@/ui/household/FollowLinkPage';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/f/$code')({
  component: FollowLinkRoute,
});

function FollowLinkRoute() {
  const { code } = Route.useParams();
  return <FollowLinkPage code={code} />;
}
