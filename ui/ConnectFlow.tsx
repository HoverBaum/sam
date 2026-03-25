import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import { basename } from "@std/path";
import type { CommandContext } from "../types.ts";
import {
  connectNeighbors,
  type ConnectNeighborHit,
  readManifest,
  readStore,
  resolveActiveProfileDir,
} from "../search/index.ts";
import {
  filterNotePaths,
  indexedPathsForPicker,
  resolvePickedNotePath,
} from "../search/noteAutocomplete.ts";
import { ShellFrame } from "./ShellFrame.tsx";
import { useTerminalRows } from "./useTerminalRows.ts";
import { VaultClient } from "../vault/client.ts";

const TOP_K = 5;
const SUGGEST_CAP = 10;

export interface ConnectFlowProps {
  context: CommandContext;
  vaultDisplay: string;
  onExit: () => void;
}

type Phase = "pick" | "loading" | "results" | "error" | "empty";

export function ConnectFlow(
  { context, vaultDisplay, onExit }: ConnectFlowProps,
) {
  const { exit } = useApp();
  const terminalRows = useTerminalRows();
  const [phase, setPhase] = useState<Phase>("pick");
  const [noteInput, setNoteInput] = useState("");
  const [indexedPaths, setIndexedPaths] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [results, setResults] = useState<ConnectNeighborHit[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const [listIndex, setListIndex] = useState(0);
  const [sourcePathLabel, setSourcePathLabel] = useState("");
  const graphCacheRef = useRef<
    Map<string, Promise<{ links: Set<string>; backlinks: Set<string> }>>
  >(new Map());

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const dir = await resolveActiveProfileDir(context.config);
        const manifest = await readManifest(dir);
        const store = await readStore(dir);
        const paths = indexedPathsForPicker(manifest, store);
        if (!cancelled) {
          if (paths.length === 0) {
            setPhase("empty");
          } else {
            setIndexedPaths(paths);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError(String((e as Error).message ?? e));
          setPhase("error");
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [context.config]);

  const suggestions = useMemo(() => {
    return filterNotePaths(noteInput, indexedPaths, SUGGEST_CAP);
  }, [noteInput, indexedPaths]);

  useEffect(() => {
    setListIndex((i) => {
      if (suggestions.length === 0) return 0;
      return Math.min(i, suggestions.length - 1);
    });
  }, [suggestions]);

  const runSearch = async (pickedPath: string) => {
    setRunError(null);
    const dir = await resolveActiveProfileDir(context.config);
    const store = await readStore(dir);
    const resolved = resolvePickedNotePath(pickedPath, indexedPaths, store);
    if (!resolved) {
      setRunError(
        "Pick a note from the list (↑↓) or type a full vault path, then Enter.",
      );
      return;
    }
    setPhase("loading");
    setSourcePathLabel(resolved);
    try {
      const vault = new VaultClient(context.config);
      const sourceLinks = await vault.links(resolved).then((rows) => rows.map((row) => row.path)).catch(() => []);
      const hits = await connectNeighbors(context.config, resolved, {
        topK: TOP_K,
        candidatePool: 60,
        sourceLinkedPaths: sourceLinks,
        graphClient: vault,
        graphCache: graphCacheRef.current,
        excludeSourceLinkedPaths: true,
      });
      setResults(hits);
      setPhase("results");
    } catch (e) {
      setRunError(String((e as Error).message ?? e));
      setPhase("pick");
    }
  };

  useInput((char, key) => {
    if (key.ctrl && char === "c") {
      exit();
      return;
    }
    if (key.escape) {
      if (phase === "results") {
        setPhase("pick");
        setResults([]);
        setSourcePathLabel("");
        setRunError(null);
        return;
      }
      onExit();
      return;
    }

    if (phase === "loading") {
      return;
    }

    if (phase === "results") {
      return;
    }

    if (phase === "empty" || phase === "error") {
      if (key.return) {
        onExit();
      }
      return;
    }

    if (key.return) {
      const chosen = suggestions.length > 0
        ? suggestions[listIndex]
        : noteInput.trim();
      void runSearch(chosen);
      return;
    }

    if (key.upArrow || char === "k") {
      if (suggestions.length > 0) {
        setListIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
      }
      return;
    }
    if (key.downArrow || char === "j") {
      if (suggestions.length > 0) {
        setListIndex((i) => (i >= suggestions.length - 1 ? 0 : i + 1));
      }
      return;
    }

    if (key.tab && suggestions.length > 0) {
      const next = suggestions[autocompleteIndex % suggestions.length];
      setNoteInput(next);
      setAutocompleteIndex((i) => (i + 1) % suggestions.length);
      setListIndex(suggestions.indexOf(next));
      return;
    }

    if (key.backspace || key.delete) {
      setNoteInput((prev) => prev.slice(0, -1));
      setAutocompleteIndex(0);
      return;
    }
    if (char) {
      setNoteInput((prev) => prev + char);
      setAutocompleteIndex(0);
    }
  });

  const footerContext = useMemo(() => {
    if (phase === "results") return "Connect · results";
    if (phase === "loading") return "Connect · searching";
    if (phase === "empty" || phase === "error") return "Connect";
    return "Connect · similar notes and sections";
  }, [phase]);

  const footerActions = useMemo(() => {
    if (phase === "results") return "Esc picker · Ctrl+C quit";
    if (phase === "loading") return "Wait for results · Ctrl+C quit";
    if (phase === "empty" || phase === "error") return "Enter or Esc back";
    return "Type to filter · ↑↓ or j/k · Enter search · Tab cycle · Esc shell";
  }, [phase]);

  if (phase === "empty") {
    return (
      <ShellFrame
        variant="sub"
        subTitle="Similar notes and sections"
        terminalRows={terminalRows}
        footerVault={vaultDisplay}
        footerContext={footerContext}
        footerRoute="/connect"
        footerActions={footerActions}
        prompt=""
        promptValue=""
      >
        <Text dimColor>
          No indexed notes yet. Run sam index first, then try again. Enter or
          Esc to go back.
        </Text>
      </ShellFrame>
    );
  }

  if (phase === "error" && loadError) {
    return (
      <ShellFrame
        variant="sub"
        subTitle="Similar notes and sections"
        terminalRows={terminalRows}
        footerVault={vaultDisplay}
        footerContext={footerContext}
        footerRoute="/connect"
        footerActions={footerActions}
        prompt=""
        promptValue=""
      >
        <Text color="red">Could not load index: {loadError}</Text>
        <Text dimColor>Press Enter or Esc to go back.</Text>
      </ShellFrame>
    );
  }

  if (phase === "loading") {
    return (
      <ShellFrame
        variant="sub"
        subTitle="Similar notes and sections"
        terminalRows={terminalRows}
        footerVault={vaultDisplay}
        footerContext={footerContext}
        footerRoute="/connect"
        footerActions={footerActions}
        prompt=""
        promptValue=""
      >
        <Box>
          <Text color="green">
            <Spinner type="dots" />
          </Text>
          <Text>Finding kindred notes…</Text>
        </Box>
      </ShellFrame>
    );
  }

  if (phase === "results") {
    return (
      <ShellFrame
        variant="sub"
        subTitle="Similar notes (multi-factor ranking)"
        terminalRows={terminalRows}
        footerVault={vaultDisplay}
        footerContext={footerContext}
        footerRoute="/connect"
        footerActions={footerActions}
        prompt=""
        promptValue=""
      >
        <Text dimColor>Esc back to picker · Ctrl+C quit</Text>
        {sourcePathLabel ? <Text dimColor>Results for: {sourcePathLabel}</Text> : null}
        {results.length === 0
          ? <Text dimColor>No other indexed notes to compare.</Text>
          : results.map((hit, i) => (
            <Text key={hit.id}>
              {`${i + 1}  ${
                String(Math.round(hit.finalScore * 100)).padStart(3, " ")
              }%  ${hit.title}  `}
              <Text dimColor>
                {hit.path}
                {hit.reasons.length > 0 ? ` · ${hit.reasons.map((reason) => reason.label).join(" · ")}` : ""}
              </Text>
            </Text>
          ))}
      </ShellFrame>
    );
  }

  return (
    <ShellFrame
      variant="sub"
      subTitle="Similar notes"
      terminalRows={terminalRows}
      footerVault={vaultDisplay}
      footerContext={footerContext}
      footerRoute="/connect"
      footerActions={footerActions}
      prompt="filter> "
      promptValue={noteInput}
    >
      <Text dimColor>
        Type to filter · ↑↓ or j/k · Enter search · Tab cycle · Esc shell
      </Text>
      {runError ? <Text color="yellow">{runError}</Text> : null}
      {suggestions.length > 0
        ? (
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>Matches (Enter uses highlighted row):</Text>
            {suggestions.map((p, i) => {
              const title = basename(p).replace(/\.md$/, "");
              const selected = i === listIndex;
              return (
                <Text key={p}>
                  <Text color={selected ? "cyan" : undefined} bold={selected}>
                    {selected ? "❯ " : "  "}
                    {title}
                  </Text>
                  <Text dimColor>{"  ·  "}{p}</Text>
                </Text>
              );
            })}
          </Box>
        )
        : noteInput.trim().length > 0
        ? (
          <Box marginTop={1}>
            <Text dimColor>No matches — keep typing or paste a full path.</Text>
          </Box>
        )
        : null}
    </ShellFrame>
  );
}
