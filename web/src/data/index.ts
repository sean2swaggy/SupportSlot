import { createHttpRepo } from "./httpRepo";
import { createLocalRepo } from "./localRepo";
import type { Repo } from "./repo";

/** `npm run app` builds with VITE_USE_API=1 and talks to the Node server (shared
 *  data, real sessions). `npm run dev` uses the browser-only repository. */
export const repo: Repo = import.meta.env.VITE_USE_API === "1"
  ? createHttpRepo()
  : createLocalRepo({
      failNext: () => typeof location !== "undefined" && new URLSearchParams(location.search).get("simulate") === "error",
    });
export type { Repo } from "./repo";
export { RepoError } from "./repo";
