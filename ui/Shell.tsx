import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box, Text, useApp, useInput, useStdin, useStdout } from "ink";
import { ScrollView, type ScrollViewRef } from "ink-scroll-view";
import SelectInput from "ink-select-input";
import {
  matchPath,
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { IndexProgressLine } from "./IndexProgressLine.tsx";
import { ConnectFlow } from "./ConnectFlow.tsx";
import { ShellFrame } from "./ShellFrame.tsx";
import { useTerminalRows } from "./useTerminalRows.ts";
import { useVaultDisplay } from "./useVaultDisplay.ts";
import {
  FIELD_LABELS,
  FIELD_ORDER,
  normalizeSettingsField,
  parseShellCommand,
  type SettingsField,
  settingsFieldPath,
} from "./shellRouting.ts";
import type { CommandContext } from "../types.ts";
import { executeIndex, indexShellMessages } from "../commands/index.tsx";
import {
  loadConfigFile,
  type SamConfigFile,
  saveConfigFile,
} from "../config.ts";
import {
  classifyStaleness,
  readManifest,
  resolveActiveProfileDir,
} from "../search/index.ts";
import { VaultClient } from "../vault/client.ts";

interface ShellProps {
  context: CommandContext;
}

interface ShellWorkspaceProps extends ShellProps {
  vaultDisplay: string;
}

interface ShellMessage {
  id: number;
  text: string;
}

interface SettingsDraft {
  vault: string;
  model: string;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingBaseUrl: string;
}

const OBSIDIAN_CONNECTION_ERROR = "Unable to connect to Obsidian main process";
const OBSIDIAN_MISSING_ERROR = "Obsidian CLI not found";
const POPULAR_MODELS = [
  "anthropic/claude-3-5-sonnet-20241022",
  "openai/gpt-4o-mini",
  "openai/gpt-4.1",
  "google/gemini-2.0-flash",
  "groq/llama-3.3-70b-versatile",
];
const EMBED_PROVIDER_SUGGESTIONS = ["ollama", "openai-compatible", "openai"];
const EMBED_MODEL_SUGGESTIONS = [
  "nomic-embed-text",
  "text-embedding-3-small",
  "text-embedding-3-large",
];
const EMBED_BASE_URL_SUGGESTIONS = [
  "http://127.0.0.1:11434",
  "https://api.openai.com/v1",
];

const TRANSCRIPT_CAP = 150;

function draftFromConfig(
  file: SamConfigFile,
  context: CommandContext,
): SettingsDraft {
  return {
    vault: file.vault ?? context.config.vault ?? "",
    model: file.model ?? context.config.model ?? "",
    embeddingProvider: file.embeddingProvider ??
      context.config.embeddingProvider ?? "",
    embeddingModel: file.embeddingModel ?? context.config.embeddingModel ?? "",
    embeddingBaseUrl: file.embeddingBaseUrl ??
      context.config.embeddingBaseUrl ?? "",
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

function ShellHomePanel() {
  return (
    <Box flexShrink={0}>
      <Text dimColor>
        Type /help for routes. Try /connect, /config, /index, or /home.
      </Text>
    </Box>
  );
}

function SettingsMenuPanel(
  { settingsItems, onSelect }: {
    settingsItems: Array<{ label: string; value: SettingsField }>;
    onSelect: (field: SettingsField) => void;
  },
) {
  return (
    <Box marginTop={1} flexDirection="column" flexShrink={0}>
      <Text color="magenta">⚙️ Settings</Text>
      <Text dimColor>
        Enter edit · S save · Esc shell · current path shows where you are
      </Text>
      <SelectInput
        items={settingsItems}
        onSelect={(item) => onSelect(item.value)}
        limit={6}
      />
    </Box>
  );
}

function SettingsEditPanel(
  { editingField, editBuffer, autoSuggestions }: {
    editingField: SettingsField;
    editBuffer: string;
    autoSuggestions: string[];
  },
) {
  return (
    <Box marginTop={1} flexDirection="column" flexShrink={0}>
      <Text color="green">Editing {FIELD_LABELS[editingField]}</Text>
      <Text dimColor>Tab autocomplete · Enter apply · Esc settings</Text>
      <Text>{editBuffer}</Text>
      {autoSuggestions.length > 0
        ? (
          <Text dimColor>
            Suggestions: {autoSuggestions.slice(0, 5).join(" · ")}
          </Text>
        )
        : null}
    </Box>
  );
}

function ShellWorkspace({ context, vaultDisplay }: ShellWorkspaceProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { setRawMode, isRawModeSupported } = useStdin();
  const navigate = useNavigate();
  const location = useLocation();
  const terminalRows = useTerminalRows();
  const scrollRef = useRef<ScrollViewRef>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ShellMessage[]>([
    { id: 1, text: "Welcome to sam. Try /index, /connect, or /config." },
  ]);
  const [busy, setBusy] = useState(false);
  const [indexProgress, setIndexProgress] = useState<
    {
      phase: string;
      done: number;
      total: number;
      phaseStartedAt: number;
    } | null
  >(null);
  const [staleHint, setStaleHint] = useState<string | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>({
    vault: context.config.vault ?? "",
    model: context.config.model ?? "",
    embeddingProvider: context.config.embeddingProvider ?? "",
    embeddingModel: context.config.embeddingModel ?? "",
    embeddingBaseUrl: context.config.embeddingBaseUrl ?? "",
  });
  const [editBuffer, setEditBuffer] = useState("");
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const [vaultSuggestions, setVaultSuggestions] = useState<string[]>([]);

  const fieldMatch = matchPath("/config/:field", location.pathname);
  const editingField = normalizeSettingsField(fieldMatch?.params.field);
  const isUnknownEditRoute = Boolean(fieldMatch && !editingField);
  const isShellHome = location.pathname === "/";
  const isSettingsMenu = location.pathname === "/config";
  const isSettingsEdit = editingField !== null;
  const isKnownRoute = isShellHome || isSettingsMenu || isSettingsEdit;

  useEffect(() => {
    if (isUnknownEditRoute) {
      navigate("/config", { replace: true });
      return;
    }
    if (!isKnownRoute) {
      navigate("/", { replace: true });
    }
  }, [isKnownRoute, isUnknownEditRoute, navigate]);

  useEffect(() => {
    if (!editingField) return;
    setEditBuffer(settingsDraft[editingField] ?? "");
    setAutocompleteIndex(0);
  }, [editingField, settingsDraft]);

  const prompt = useMemo(() => {
    if (busy && !indexProgress) return "sam (busy)> ";
    if (busy) return "sam> ";
    if (isSettingsMenu) return "config> ";
    if (editingField) return `config/${editingField}> `;
    return "sam> ";
  }, [busy, indexProgress, isSettingsMenu, editingField]);

  const footerContext = useMemo(() => {
    if (busy && indexProgress) return "Indexing";
    if (busy) return "Busy";
    if (editingField) return `Settings · edit ${FIELD_LABELS[editingField]}`;
    if (isSettingsMenu) return "Settings";
    return "Home shell";
  }, [busy, indexProgress, editingField, isSettingsMenu]);

  const footerActions = useMemo(() => {
    if (busy) return "Wait for index run to finish · Ctrl+C quit";
    if (editingField) {
      return "Type value · Tab autocomplete · Enter apply · Esc settings";
    }
    if (isSettingsMenu) {
      return "↑↓ pick field · Enter edit · S save · Esc shell";
    }
    return "/connect similar notes · /config settings · /index refresh index · /help routes";
  }, [busy, editingField, isSettingsMenu]);

  const pushMessage = (text: string) => {
    setMessages((prev: ShellMessage[]) => {
      const id = prev.length > 0 ? prev[prev.length - 1].id + 1 : 1;
      const next = [...prev, { id, text }];
      return next.length > TRANSCRIPT_CAP ? next.slice(-TRANSCRIPT_CAP) : next;
    });
  };

  const settingsItems = useMemo(
    () =>
      FIELD_ORDER.map((field) => ({
        label: `${FIELD_LABELS[field]}: ${settingsDraft[field] || "(empty)"}`,
        value: field,
      })),
    [settingsDraft],
  );

  const autoSuggestions = useMemo(() => {
    if (!editingField) return [];
    if (editingField === "vault") return trimSuggestions(vaultSuggestions);
    if (editingField === "model") return trimSuggestions(POPULAR_MODELS);
    if (editingField === "embeddingProvider") {
      return trimSuggestions(EMBED_PROVIDER_SUGGESTIONS);
    }
    if (editingField === "embeddingModel") {
      return trimSuggestions(EMBED_MODEL_SUGGESTIONS);
    }
    return trimSuggestions(EMBED_BASE_URL_SUGGESTIONS);
  }, [editingField, vaultSuggestions]);

  useLayoutEffect(() => {
    scrollRef.current?.scrollToBottom();
  }, [messages]);

  useLayoutEffect(() => {
    if (!isRawModeSupported) return;
    setRawMode(true);
  }, [location.pathname, isRawModeSupported, setRawMode]);

  useEffect(() => {
    const onResize = () => scrollRef.current?.remeasure();
    stdout?.on?.("resize", onResize);
    return () => {
      stdout?.off?.("resize", onResize);
    };
  }, [stdout]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const vault = new VaultClient(context.config);

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
          "JSON.stringify(app.vault.getMarkdownFiles().map(f=>({path:f.path,mtime:f.stat.mtime})))",
        );
        const files = JSON.parse(evalResult) as Array<
          { path: string; mtime: number }
        >;
        const profileDir = await resolveActiveProfileDir(context.config);
        const manifest = await readManifest(profileDir);
        const summary = classifyStaleness(manifest, files);
        const changed = summary.newPaths.length + summary.modifiedPaths.length +
          summary.deletedPaths.length;
        if (!cancelled && changed > 0) {
          setStaleHint(
            `${changed} notes changed since last index — run sam index to update.`,
          );
        }
      } catch (error) {
        if (!cancelled) {
          const message = String((error as Error).message ?? error);
          if (message.includes(OBSIDIAN_CONNECTION_ERROR)) {
            setStaleHint(
              "Obsidian CLI is available but not connected. Open Obsidian and retry.",
            );
          } else if (message.includes(OBSIDIAN_MISSING_ERROR)) {
            setStaleHint(
              "Obsidian CLI not found in PATH. Install/enable Obsidian CLI.",
            );
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

  const openSettingsMenu = async () => {
    const file = await loadConfigFile();
    const draft = draftFromConfig(file, context);
    setSettingsDraft(draft);
    setAutocompleteIndex(0);
    navigate("/config");
    pushMessage(
      "🎛️  Settings opened. Route is now /config. ↑/↓ select · Enter edit · S save · Esc shell.",
    );
  };

  const beginEditingField = (field: SettingsField) => {
    setAutocompleteIndex(0);
    navigate(settingsFieldPath(field));
    pushMessage(
      `Editing ${FIELD_LABELS[field]} at ${
        settingsFieldPath(field)
      }. Tab suggestions · Enter apply · Esc settings.`,
    );
  };

  const saveSettings = async () => {
    const file = await loadConfigFile();
    const merged: SamConfigFile = {
      ...file,
      vault: settingsDraft.vault || undefined,
      model: settingsDraft.model || undefined,
      embeddingProvider: (settingsDraft
        .embeddingProvider as SamConfigFile["embeddingProvider"]) ||
        undefined,
      embeddingModel: settingsDraft.embeddingModel || undefined,
      embeddingBaseUrl: settingsDraft.embeddingBaseUrl || undefined,
    };
    await saveConfigFile(merged);
    navigate("/");
    pushMessage(
      "✨ Settings saved! Restart sam to apply config resolution changes.",
    );
  };

  const applyEditedValue = () => {
    if (!editingField) return;
    const field = editingField;
    setSettingsDraft((prev: SettingsDraft) => ({
      ...prev,
      [field]: editBuffer.trim(),
    }));
    navigate("/config");
    pushMessage(`${FIELD_LABELS[field]} updated.`);
  };

  useInput(
    async (char, key) => {
      if (location.pathname === "/connect") return;
      if (busy) return;

      if (key.ctrl && char === "c") {
        exit();
        return;
      }

      if (editingField) {
        if (key.escape) {
          navigate("/config");
          setEditBuffer("");
          pushMessage("Edit canceled.");
          return;
        }
        if (key.return) {
          applyEditedValue();
          return;
        }
        if (key.tab && autoSuggestions.length > 0) {
          const next =
            autoSuggestions[autocompleteIndex % autoSuggestions.length];
          setEditBuffer(next);
          setAutocompleteIndex((idx: number) =>
            (idx + 1) % autoSuggestions.length
          );
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

      if (isSettingsMenu) {
        if (key.escape) {
          navigate("/");
          pushMessage("Settings closed (no save).");
          return;
        }
        if (char?.toLowerCase() === "s") {
          try {
            await saveSettings();
          } catch (error) {
            pushMessage(
              `Failed to save settings: ${
                String((error as Error).message ?? error)
              }`,
            );
          }
          return;
        }
        return;
      }

      if (key.return) {
        const command = parseShellCommand(input);
        setInput("");

        if (command.kind === "noop") return;
        if (command.kind === "navigate") {
          if (command.path === "/config") {
            try {
              await openSettingsMenu();
            } catch (error) {
              pushMessage(
                `Failed to open settings: ${
                  String((error as Error).message ?? error)
                }`,
              );
            }
            return;
          }
          navigate(command.path);
          if (command.path === "/connect") {
            pushMessage("Navigating to /connect.");
          }
          return;
        }
        if (command.kind === "unknown") {
          pushMessage("Unknown command. Try /help.");
          return;
        }
        if (command.kind === "help") {
          pushMessage(
            "Routes: /home, /connect, /config, /config/<field>. Commands: /new, /index, /help. Ctrl+C exits.",
          );
          return;
        }
        if (command.kind === "new") {
          pushMessage("/new is planned for Phase 1.");
          return;
        }
        if (command.kind === "index") {
          setBusy(true);
          setIndexProgress({
            phase: "Starting",
            done: 0,
            total: 1,
            phaseStartedAt: Date.now(),
          });
          pushMessage("Starting index run...");
          try {
            const result = await executeIndex(
              context,
              { flags: {}, positionals: [] },
              (patch) => {
                setIndexProgress((prev) => {
                  const base = prev ??
                    {
                      phase: "Starting",
                      done: 0,
                      total: 1,
                      phaseStartedAt: Date.now(),
                    };
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
              pushMessage(
                "Index failed: Obsidian is not connected. Open Obsidian and retry.",
              );
            } else if (message.includes(OBSIDIAN_MISSING_ERROR)) {
              pushMessage("Index failed: Obsidian CLI not found in PATH.");
            } else {
              pushMessage(`Index failed: ${message}`);
            }
          } finally {
            setBusy(false);
            setIndexProgress(null);
          }
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
    },
  );

  const promptValue = editingField ? editBuffer : input;

  return (
    <ShellFrame
      variant="home"
      terminalRows={terminalRows}
      footerVault={vaultDisplay}
      footerContext={footerContext}
      footerRoute={location.pathname}
      footerActions={footerActions}
      prompt={prompt}
      promptValue={promptValue}
    >
      {staleHint
        ? (
          <Box flexShrink={0}>
            <Text color="yellow">{staleHint}</Text>
          </Box>
        )
        : null}

      <Box
        flexGrow={1}
        flexShrink={1}
        minHeight={4}
        width="100%"
        overflow="hidden"
        flexDirection="column"
      >
        <ScrollView ref={scrollRef}>
          {messages.map((msg: ShellMessage) => (
            <Text key={msg.id}>{msg.text}</Text>
          ))}
        </ScrollView>
      </Box>

      <Routes>
        <Route path="/" element={<ShellHomePanel />} />
        <Route
          path="/config"
          element={
            <SettingsMenuPanel
              settingsItems={settingsItems}
              onSelect={beginEditingField}
            />
          }
        />
        <Route
          path="/config/:field"
          element={editingField
            ? (
              <SettingsEditPanel
                editingField={editingField}
                editBuffer={editBuffer}
                autoSuggestions={autoSuggestions}
              />
            )
            : null}
        />
      </Routes>

      {busy && indexProgress
        ? (
          <Box marginTop={1} flexShrink={0}>
            <IndexProgressLine
              phase={indexProgress.phase}
              done={indexProgress.done}
              total={indexProgress.total}
              phaseStartedAt={indexProgress.phaseStartedAt}
            />
          </Box>
        )
        : null}
    </ShellFrame>
  );
}

function ShellRoutes({ context }: ShellProps) {
  const navigate = useNavigate();
  const vaultDisplay = useVaultDisplay(context);

  return (
    <Routes>
      <Route
        path="/connect"
        element={
          <ConnectFlow
            context={context}
            vaultDisplay={vaultDisplay}
            onExit={() => navigate("/")}
          />
        }
      />
      <Route
        path="*"
        element={
          <ShellWorkspace context={context} vaultDisplay={vaultDisplay} />
        }
      />
    </Routes>
  );
}

export function Shell(props: ShellProps) {
  return (
    <MemoryRouter initialEntries={["/"]}>
      <ShellRoutes context={props.context} />
    </MemoryRouter>
  );
}
