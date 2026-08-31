export const ACCESS_MODES = Object.freeze(["full-access", "workspace", "read-only", "custom", "unknown"]);
export const CONTEXT_OVERRIDE_STATES = Object.freeze(["extended", "default", "unknown"]);
export const SERVICE_TIERS = Object.freeze(["default", "priority", "ultrafast", "unknown"]);

function boundedText(value, maxLength) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

export function accessModeFromProfile(profile) {
  const normalized = boundedText(profile, 80)?.toLowerCase() || "";
  if (!normalized) return "unknown";
  if (normalized.includes("danger-full-access") || normalized === "disabled") return "full-access";
  if (normalized.includes("workspace")) return "workspace";
  if (normalized.includes("read-only") || normalized.includes("readonly")) return "read-only";
  return "custom";
}

export function normalizeServiceTier(value) {
  const normalized = boundedText(value, 40)?.toLowerCase() || "";
  if (!normalized) return null;
  if (normalized === "fast") return "priority";
  return SERVICE_TIERS.includes(normalized) && normalized !== "unknown" ? normalized : null;
}

export function normalizeThreadSettings(settings = {}) {
  const activeProfile = boundedText(settings?.active_permission_profile?.id ?? settings?.permissionProfile, 80);
  const configuredProfile = boundedText(settings?.permission_profile?.type, 40);
  const permissionProfile = activeProfile || configuredProfile;
  const storedAccessMode = ACCESS_MODES.includes(settings?.accessMode) ? settings.accessMode : null;
  return Object.freeze({
    model: boundedText(settings?.model, 120),
    reasoningEffort: boundedText(settings?.reasoning_effort ?? settings?.reasoningEffort, 40),
    serviceTier: normalizeServiceTier(settings?.service_tier ?? settings?.serviceTier),
    approvalPolicy: boundedText(settings?.approval_policy ?? settings?.approvalPolicy, 40),
    permissionProfile,
    accessMode: storedAccessMode || accessModeFromProfile(permissionProfile)
  });
}
