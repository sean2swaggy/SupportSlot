import { createLocalRepo } from "./localRepo";

/** Swap this one line for a Supabase-backed Repo to add real persistence. */
export const repo = createLocalRepo({
  failNext: () => typeof location !== "undefined" && new URLSearchParams(location.search).get("simulate") === "error",
});
export type { Repo } from "./repo";
export { RepoError } from "./repo";
