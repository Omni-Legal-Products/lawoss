import { Navigate } from "react-router-dom";
import { readActiveWorkspaceId } from "../../../react-app/shell/session-memory";
import { nativeIntegrationRoute } from "./native-actions";

/** Legacy bookmarks reuse the native selection; no separate connection/bootstrap. */
export function NativeIntegrationsRedirect({ from }: { from: "/marketplace" | "/konektory" }) {
  return <Navigate replace to={nativeIntegrationRoute(from, readActiveWorkspaceId())} />;
}
