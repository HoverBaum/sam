export type SettingsField =
  | "vault"
  | "model"
  | "embeddingProvider"
  | "embeddingModel"
  | "embeddingBaseUrl";

export type ShellCommand =
  | { kind: "noop" }
  | { kind: "unknown" }
  | { kind: "help" }
  | { kind: "index" }
  | { kind: "new" }
  | { kind: "navigate"; path: "/" | "/connect" | "/config" };

export const FIELD_ORDER: SettingsField[] = [
  "vault",
  "model",
  "embeddingProvider",
  "embeddingModel",
  "embeddingBaseUrl",
];

export const FIELD_LABELS: Record<SettingsField, string> = {
  vault: "Vault",
  model: "AI Model",
  embeddingProvider: "Embedding Provider",
  embeddingModel: "Embedding Model",
  embeddingBaseUrl: "Embedding Base URL",
};

export function normalizeSettingsField(
  value: string | null | undefined,
): SettingsField | null {
  if (value === "vault") return "vault";
  if (value === "model") return "model";
  if (value === "embeddingProvider") return "embeddingProvider";
  if (value === "embeddingModel") return "embeddingModel";
  if (value === "embeddingBaseUrl") return "embeddingBaseUrl";
  return null;
}

export function settingsFieldPath(
  field: SettingsField,
): `/config/${SettingsField}` {
  return `/config/${field}`;
}

export function parseShellCommand(input: string): ShellCommand {
  const trimmed = input.trim();

  if (trimmed === "") return { kind: "noop" };
  if (trimmed.startsWith("/new")) return { kind: "new" };
  if (trimmed.startsWith("/index")) return { kind: "index" };
  if (trimmed.startsWith("/connect")) {
    return { kind: "navigate", path: "/connect" };
  }
  if (trimmed.startsWith("/config") || trimmed.startsWith("/settings")) {
    return { kind: "navigate", path: "/config" };
  }
  if (trimmed === "/home") return { kind: "navigate", path: "/" };
  if (trimmed === "/help" || trimmed === "help") return { kind: "help" };
  return { kind: "unknown" };
}
