"use client";

import { useEffect } from "react";

/**
 * Clean URLs are served as their own static pages, but the app itself is hash
 * routed. The meta refresh lands users on the right route before any JS runs.
 */
export function HashRouteRedirect({ route }: { route: string }) {
  const target = `/#${route}`;

  useEffect(() => {
    if (`${window.location.pathname}${window.location.hash}` !== target) {
      window.location.replace(target);
    }
  }, [target]);

  return <meta httpEquiv="refresh" content={`0;url=${target}`} />;
}
