import { getContainer } from "@/infrastructure/container";
import { DbIndicator } from "./db-indicator";

/**
 * Server component that fetches the current repo mode + DB path and renders
 * the client-side indicator/dialog. Drop into any authenticated page header.
 */
export async function DbHeader() {
  const c = getContainer();
  return <DbIndicator repoMode={c.repoMode} dbPath={c.dbPath} />;
}
