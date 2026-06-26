import { config } from "../config.js";

// AUTH GROUNDWORK — single swap point.
// Today this injects the default tenant/user so the API works without auth.
// When auth is built, replace the body with: verify the session/JWT/API key,
// load the tenant + user from it, 401 on failure, and set req.tenantId /
// req.userId from the authenticated principal. No route or query changes needed.
export function requireTenant(req, _res, next) {
  req.tenantId = req.get("x-tenant-id") || config.defaultTenantId;
  req.userId = req.get("x-user-id") || config.defaultUserId;
  next();
}
