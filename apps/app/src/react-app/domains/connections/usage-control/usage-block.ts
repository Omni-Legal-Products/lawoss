/** Explain the spending boundary that actually blocks this member. */
export function usageBlockMessageKey(reason: string | null, isAdmin: boolean) {
  switch (reason) {
    case "member_limit":
      return isAdmin ? "limits.blocked_member_admin" : "limits.blocked_member";
    case "organization_limit":
      return isAdmin ? "limits.blocked_organization_admin" : "limits.blocked_organization";
    case "wallet_empty":
      return isAdmin ? "limits.blocked_wallet_admin" : "limits.blocked_wallet";
    case "extra_disabled":
      return isAdmin ? "limits.blocked_disabled_admin" : "limits.blocked_disabled";
    case "seat_required":
      return isAdmin ? "limits.blocked_seat_admin" : "limits.blocked_seat";
    default:
      return "limits.blocked";
  }
}

export function usageBlockNeedsSettings(reason: string | null) {
  return reason === "member_limit" || reason === "organization_limit" || reason === "extra_disabled";
}

export function usageRequestMessageKey(reason: string | null, isAdmin: boolean) {
  if (reason === "member_limit") return isAdmin ? "limits.request_member_admin" : "limits.request_member";
  if (reason === "organization_limit") return isAdmin ? "limits.request_organization_admin" : "limits.request_organization";
  if (reason === "wallet_empty") return isAdmin ? "limits.request_wallet_admin" : "limits.request_wallet";
  if (reason === "service_limit") return "limits.request_service";
  return usageBlockMessageKey(reason, isAdmin);
}
