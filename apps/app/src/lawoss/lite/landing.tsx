/** @jsxImportSource react */
import { Navigate } from "react-router-dom";
import { useUiMode } from "./ui-mode";
import { landingPath } from "./visibility";

/** Trasa `/`: lite začíná na „Dnes“, pro na přehledu spisů jako dosud. */
export function LawossLanding() {
  return <Navigate to={landingPath(useUiMode())} replace />;
}
