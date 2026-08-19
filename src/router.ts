/**
 * Hash based routing. A hash keeps every deployment path working, including
 * a GitHub Pages project sub path, without any server rewrite rules.
 */
import { useCallback, useEffect, useState } from "react";

export const ROUTES = [
  "home",
  "add",
  "review",
  "settings",
  "transactions",
  "categories",
  "recurring",
] as const;

export type Route = (typeof ROUTES)[number];

function parse(hash: string): Route {
  const value = hash.replace(/^#\/?/, "");
  return (ROUTES as readonly string[]).includes(value) ? (value as Route) : "home";
}

export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parse(location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parse(location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((next: Route) => {
    location.hash = `#/${next}`;
  }, []);

  return [route, navigate];
}
