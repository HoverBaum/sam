import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { IndexProgressLine } from "./IndexProgressLine.tsx";
import { ConnectFlow } from "./ConnectFlow.tsx";
import type { CommandContext } from "../types.ts";
import { executeIndex, indexShellMessages } from "../commands/index.tsx";
import { loadConfigFile, saveConfigFile, type SamConfigFile } from "../config.ts";
import {
  classifyStaleness,
  readManifest,
  resolveActiveProfileDir,
} from "../search/index.ts";
import { VaultClient } from "../vault/client.ts";

interface ShellProps {
  context: CommandContext;
}

interface ShellMainProps extends ShellProps {
  onOpenConnect: () => void;
}

interface ShellMessage {
  id: number;
  text: string;
}

type Route = "/new" | "/index" | "/connect" | "/config" | "help" | "";
type SettingsField =
  | "vault"
  | "model"
  | "embeddingProvider"
  | "embeddingModel"
  | "embeddingBaseUrl";

interface SettingsDraft {
  vault: string;
  model: string;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingBaseUrl: string;
}

type UiMode = "shell" | "settings-menu" | "settings-edit";

const OBSIDIAN_CONNECTION_ERROR = "Unable to connect to Obsidian main process";
const OBSIDIAN_MISSING_ERROR = "Obsidian CLI not found";
const FIELD_ORDER: SettingsField[] = [
  "vault",
  "model",
  "embeddingProvider",
  "embeddingModel",
  "embeddingBaseUrl",
];
const FIELD_LABELS: Record<SettingsField, string> = {
  vault: "Vault",
  model: "AI Model",
  embeddingProvider: "Embedding Provider",
  embeddingModel: "Embedding Model",
  embeddingBaseUrl: "Embedding Base URL",
};
const POPULAR_MODELS = [
  "anthropic/claude-3-5-sonnet-20241022",
  "openai/gpt-4o-mini",
  "openai/gpt-4.1",
  "google/gemini-2.0-flash",
  "groq/llama-3.3-70b-versatile",
];
const EMBED_PROVIDER_SUGGESTIONS = ["ollama", "openai-compatible", "openai"];
const EMBED_MODEL_SUGGESTIONS = ["nomic-embed-text", "text-embedding-3-small", "text-embedding-3-large"];
const EMBED_BASE_URL_SUGGESTIONS = ["http://127.0.0.1:11434", "https://api.openai.com/v1"];

function parseRoute(input: string): Route {
  const trimmed = input.trim();
  if (trimmed.startsWith("/new")) return "/new";
  if (trimmed.startsWith("/index")) return "/index";
  if (trimmed.startsWith("/connect")) return "/connect";
  if (trimmed.startsWith("/config") || trimmed.startsWith("/settings")) return "/config";
  if (trimmed === "/help" || trimmed === "help") return "help";
  return "";
}

function draftFromConfig(file: SamConfigFile, context: CommandContext): SettingsDraft {
  return {
    vault: file.vault ?? context.config.vault ?? "",
    model: file.model ?? context.config.model ?? "",
    embeddingProvider: file.embeddingProvider ?? context.config.embeddingProvider ?? "",
    embeddingModel: file.embeddingModel ?? context.config.embeddingModel ?? "",
    embeddingBaseUrl: file.embeddingBaseUrl ?? context.config.embeddingBaseUrl ?? "",
  };
}

function trimSuggestions(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = value.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function ShellMain({ context, onOpenConnect }: ShellMainProps) {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ShellMessage[]>([
    { id: 1, text: "Welcome to sam. Try /index, /connect, or /config." },
  ]);
  const [busy, setBusy] = useState(false);
  const [indexProgress, setIndexProgress] = useState<{
    phase: string;
    done: number;
    total: number;
    phaseStartedAt: number;
  } | null>(null);
  const [staleHint, setStaleHint] = useState<string | null>(null);
  const [vaultDisplay, setVaultDisplay] = useState<string>(
    context.config.vault?.trim().length ? context.config.vault : "(resolving...)",
  );
  const [uiMode, setUiMode] = useState<UiMode>("shell");
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>({
    vault: context.config.vault ?? "",
    model: context.config.model ?? "",
    embeddingProvider: context.config.embeddingProvider ?? "",
    embeddingModel: context.config.embeddingModel ?? "",
    embeddingBaseUrl: context.config.embeddingBaseUrl ?? "",
  });
  const [selectedFieldIndex, setSelectedFieldIndex] = useState(0);
  const [editingField, setEditingField] = useState<SettingsField | null>(null);
  const [editBuffer, setEditBuffer] = useState("");
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const [vaultSuggestions, setVaultSuggestions] = useState<string[]>([]);

  const prompt = useMemo(() => {
    if (busy && !indexProgress) return "sam (busy)> ";
    if (busy) return "sam> ";
    if (uiMode === "settings-menu") return "settings> ";
    if (uiMode === "settings-edit" && editingField) return `edit ${editingField}> `;
    return "sam> ";
  }, [busy, indexProgress, uiMode, editingField]);

  const pushMessage = (text: string) => {
    setMessages((prev: ShellMessage[]) => {
      const id = prev.length > 0 ? prev[prev.length - 1].id + 1 : 1;
      return [...prev, { id, text }];
    });
  };

  const currentField = FIELD_ORDER[selectedFieldIndex];
  const autoSuggestions = useMemo(() => {
    if (!editingField) return [];
    if (editingField === "vault") return trimSuggestions(vaultSuggestions);
    if (editingField === "model") return trimSuggestions(POPULAR_MODELS);
    if (editingField === "embeddingProvider") return trimSuggestions(EMBED_PROVIDER_SUGGESTIONS);
    if (editingField === "embeddingModel") return trimSuggestions(EMBED_MODEL_SUGGESTIONS);
    return trimSuggestions(EMBED_BASE_URL_SUGGESTIONS);
  }, [editingField, vaultSuggestions]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const vault = new VaultClient(context.config);

      try {
        const currentName = await vault.currentVaultName();
        if (!cancelled) {
          setVaultDisplay(currentName);
        }
      } catch (error) {
        if (!cancelled) {
          const message = String((error as Error).message ?? error);
          if (message.includes(OBSIDIAN_CONNECTION_ERROR)) {
            setVaultDisplay("(unavailable: open Obsidian)");
          } else if (message.includes(OBSIDIAN_MISSING_ERROR)) {
            setVaultDisplay("(unavailable: CLI missing)");
          } else {
            setVaultDisplay("(unavailable)");
          }
        }
      }

      try {
        const names = await vault.listVaultNames();
        if (!cancelled && names.length > 0) {
          setVaultSuggestions(names);
        }
      } catch {
        // Non-critical: static suggestions still make settings usable.
      }

      try {
        const evalResult = await vault.eval(
          'JSON.stringify(app.vault.getMarkdownFiles().map(f=>({path:f.path,mtime:f.stat.mtime})))',
        );
        const files = JSON.parse(evalResult) as Array<{ path: string; mtime: number }>;
        const profileDir = await resolveActiveProfileDir(context.config);
        const manifest = await readManifest(profileDir);
        const summary = classifyStaleness(manifest, files);
        const changed = summary.newPaths.length + summary.modifiedPaths.length + summary.deletedPaths.length;
        if (!cancelled && changed > 0) {
          setStaleHint(`${changed} notes changed since last index — run sam index to update.`);
        }
      } catch (error) {
        if (!cancelled) {
          const message = String((error as Error).message ?? error);
          if (message.includes(OBSIDIAN_CONNECTION_ERROR)) {
            setStaleHint("Obsidian CLI is available but not connected. Open Obsidian and retry.");
          } else if (message.includes(OBSIDIAN_MISSING_ERROR)) {
            setStaleHint("Obsidian CLI not found in PATH. Install/enable Obsidian CLI.");
          } else {
            setStaleHint("Could not check index staleness.");
          }
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [context.config]);

  const startSettingsMenu = async () => {
    const file = await loadConfigFile();
    const draft = draftFromConfig(file, context);
    setSettingsDraft(draft);
    setUiMode("settings-menu");
    setSelectedFieldIndex(0);
    setEditingField(null);
    setEditBuffer("");
    setAutocompleteIndex(0);
    pushMessage("🎛️  Settings opened. Use ↑/↓ to pick, Enter to edit, S to save, Esc to cancel.");
  };

  const beginEditingField = (field: SettingsField) => {
    setEditingField(field);
    setEditBuffer(settingsDraft[field] ?? "");
    setAutocompleteIndex(0);
    setUiMode("settings-edit");
    pushMessage(`Editing ${FIELD_LABELS[field]}. Press Tab for suggestions, Enter to apply.`);
  };

  const saveSettings = async () => {
    const file = await loadConfigFile();
    const merged: SamConfigFile = {
      ...file,
      vault: settingsDraft.vault || undefined,
      model: settingsDraft.model || undefined,
      embeddingProvider: (settingsDraft.embeddingProvider as SamConfigFile["embeddingProvider"]) || undefined,
      embeddingModel: settingsDraft.embeddingModel || undefined,
      embeddingBaseUrl: settingsDraft.embeddingBaseUrl || undefined,
    };
    await saveConfigFile(merged);
    setUiMode("shell");
    setEditingField(null);
    pushMessage("✨ Settings saved! Restart sam to apply config resolution changes.");
  };

  const applyEditedValue = () => {
    if (!editingField) return;
    setSettingsDraft((prev: SettingsDraft) => ({
      ...prev,
      [editingField]: editBuffer.trim(),
    }));
    setUiMode("settings-menu");
    setEditingField(null);
    pushMessage(`${FIELD_LABELS[editingField]} updated.`);
  };

  useInput(async (char, key) => {
    if (busy) return;
    if (key.ctrl && char === "c") {
      exit();
      return;
    }

    if (uiMode === "settings-edit") {
      if (key.escape) {
        setUiMode("settings-menu");
        setEditingField(null);
        setEditBuffer("");
        pushMessage("Edit canceled.");
        return;
      }
      if (key.return) {
        applyEditedValue();
        return;
      }
      if (key.tab && autoSuggestions.length > 0) {
        const next = autoSuggestions[autocompleteIndex % autoSuggestions.length];
        setEditBuffer(next);
        setAutocompleteIndex((idx: number) => (idx + 1) % autoSuggestions.length);
        return;
      }
      if (key.backspace || key.delete) {
        setEditBuffer((prev: string) => prev.slice(0, -1));
        return;
      }
      if (char) {
        setEditBuffer((prev: string) => prev + char);
      }
      return;
    }

    if (uiMode === "settings-menu") {
      if (key.escape) {
        setUiMode("shell");
        pushMessage("Settings closed (no save).");
        return;
      }
      if (key.upArrow) {
        setSelectedFieldIndex((idx: number) => (idx <= 0 ? FIELD_ORDER.length - 1 : idx - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedFieldIndex((idx: number) => (idx + 1) % FIELD_ORDER.length);
        return;
      }
      if (key.return) {
        beginEditingField(currentField);
        return;
      }
      if (char?.toLowerCase() === "s") {
        try {
          await saveSettings();
        } catch (error) {
          pushMessage(`Failed to save settings: ${String((error as Error).message ?? error)}`);
        }
        return;
      }
      return;
    }

    if (key.return) {
      const route = parseRoute(input);
      const raw = input.trim();
      setInput("");

      if (route === "/config") {
        try {
          await startSettingsMenu();
        } catch (error) {
          pushMessage(`Failed to open settings: ${String((error as Error).message ?? error)}`);
        }
        return;
      }
      if (route === "") {
        pushMessage("Unknown command. Try /help.");
        return;
      }
      if (route === "help") {
        pushMessage("Routes: /new, /index, /connect, /config (/settings alias), /help. Ctrl+C exits.");
        return;
      }
      if (route === "/connect") {
        onOpenConnect();
        return;
      }
      if (route === "/new") {
        pushMessage("/new is planned for Phase 1.");
        return;
      }
      if (route === "/index") {
        setBusy(true);
        setIndexProgress({ phase: "Starting", done: 0, total: 1, phaseStartedAt: Date.now() });
        pushMessage("Starting index run...");
        try {
          const result = await executeIndex(
            context,
            { flags: {}, positionals: [] },
            (patch) => {
              setIndexProgress((prev) => {
                const base = prev ?? { phase: "Starting", done: 0, total: 1, phaseStartedAt: Date.now() };
                return {
                  phase: patch.phase ?? base.phase,
                  done: patch.done ?? base.done,
                  total: patch.total ?? base.total,
                  phaseStartedAt: patch.phaseStartedAt ?? base.phaseStartedAt,
                };
              });
            },
            { continueOnEmbedError: true },
          );
          for (const message of indexShellMessages(result)) {
            pushMessage(message);
          }
        } catch (error) {
          const message = String((error as Error).message ?? error);
          if (message.includes(OBSIDIAN_CONNECTION_ERROR)) {
            pushMessage("Index failed: Obsidian is not connected. Open Obsidian and retry.");
          } else if (message.includes(OBSIDIAN_MISSING_ERROR)) {
            pushMessage("Index failed: Obsidian CLI not found in PATH.");
          } else {
            pushMessage(`Index failed: ${message}`);
          }
        } finally {
          setBusy(false);
          setIndexProgress(null);
        }
        return;
      }
      if (raw) {
        pushMessage("Unknown command. Try /help.");
      }
      return;
    }

    if (key.backspace || key.delete) {
      setInput((prev: string) => prev.slice(0, -1));
      return;
    }
    if (char) {
      setInput((prev: string) => prev + char);
    }
  });

  return (
    <Box flexDirection="column">
      <Text color="cyan">sam — personal knowledge companion</Text>
      <Text dimColor>Vault: {vaultDisplay}</Text>
      <Text dimColor>Type /help for routes.</Text>
      {staleHint ? <Text color="yellow">{staleHint}</Text> : null}

      {uiMode === "settings-menu"
        ? (
          <Box marginTop={1} flexDirection="column">
            <Text color="magenta">⚙️  Settings</Text>
            <Text dimColor>Enter edit • S save • Esc cancel</Text>
            {FIELD_ORDER.map((field, idx) => {
              const marker = idx === selectedFieldIndex ? "❯" : " ";
              const value = settingsDraft[field] || "(empty)";
              return (
                <Text key={field}>
                  {marker} {FIELD_LABELS[field]}: {value}
                </Text>
              );
            })}
          </Box>
        )
        : null}

      {uiMode === "settings-edit" && editingField
        ? (
          <Box marginTop={1} flexDirection="column">
            <Text color="green">Editing {FIELD_LABELS[editingField]}</Text>
            <Text dimColor>Tab autocomplete • Enter apply • Esc cancel</Text>
            <Text>{editBuffer}</Text>
            {autoSuggestions.length > 0
              ? (
                <Text dimColor>
                  Suggestions: {autoSuggestions.slice(0, 5).join(" · ")}
                </Text>
              )
              : null}
          </Box>
        )
        : null}

      <Box marginTop={1} flexDirection="column">
        {messages.slice(-6).map((msg: ShellMessage) => (
          <Text key={msg.id}>{msg.text}</Text>
        ))}
      </Box>
      {busy && indexProgress
        ? (
          <Box marginTop={1}>
            <IndexProgressLine
              phase={indexProgress.phase}
              done={indexProgress.done}
              total={indexProgress.total}
              phaseStartedAt={indexProgress.phaseStartedAt}
            />
          </Box>
        )
        : null}
      <Text>
        {prompt}
        {uiMode === "settings-edit" ? editBuffer : input}
      </Text>
    </Box>
  );
}

export function Shell(props: ShellProps) {
  const [flow, setFlow] = useState<"main" | "connect">("main");
  if (flow === "connect") {
    return <ConnectFlow context={props.context} onExit={() => setFlow("main")} />;
  }
  return <ShellMain context={props.context} onOpenConnect={() => setFlow("connect")} />;
}
