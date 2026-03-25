import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import { basename } from "@std/path";
import type { CommandContext } from "../types.ts";
import {
  nearestNeighbors,
  readManifest,
  readStore,
  resolveActiveProfileDir,
  type NeighborHit,
} from "../search/index.ts";
import {
  filterNotePaths,
  indexedPathsForPicker,
  resolvePickedNotePath,
} from "../search/noteAutocomplete.ts";
import { ShellFrame } from "./ShellFrame.tsx";
import { useTerminalRows } from "./useTerminalRows.ts";

const TOP_K = 5;
const SUGGEST_CAP = 10;

export interface ConnectFlowProps {
  context: CommandContext;
  vaultDisplay: string;
  onExit: () => void;
}

type Phase = "pick" | "loading" | "results" | "error" | "empty";

export function ConnectFlow({ context, vaultDisplay, onExit }: ConnectFlowProps) {
  const { exit } = useApp();
  const terminalRows = useTerminalRows();
  const [phase, setPhase] = useState<Phase>("pick");
  const [noteInput, setNoteInput] = useState("");
  const [indexedPaths, setIndexedPaths] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [results, setResults] = useState<NeighborHit[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const [listIndex, setListIndex] = useState(0);

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
      setRunError("Pick a note from the list (↑↓) or type a full vault path, then Enter.");
      return;
    }
    setPhase("loading");
    try {
      const hits = await nearestNeighbors(context.config, resolved, TOP_K);
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
      const chosen = suggestions.length > 0 ? suggestions[listIndex] : noteInput.trim();
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

  if (phase === "empty") {
    return (
      <ShellFrame
        variant="sub"
        subTitle="Similar notes and sections"
        terminalRows={terminalRows}
        footerVault={vaultDisplay}
        footerContext={footerContext}
        prompt=""
        promptValue=""
      >
        <Text dimColor>
          No indexed notes yet. Run sam index first, then try again. Enter or Esc to go back.
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
        prompt=""
        promptValue=""
      >
        <Box>
          <Text color="green">
            <Spinner type="dots" />
          </Text>
          <Text> Finding kindred notes…</Text>
        </Box>
      </ShellFrame>
    );
  }

  if (phase === "results") {
    return (
      <ShellFrame
        variant="sub"
        subTitle="Similar notes and sections (cosine similarity)"
        terminalRows={terminalRows}
        footerVault={vaultDisplay}
        footerContext={footerContext}
        prompt=""
        promptValue=""
      >
        <Text dimColor>Esc back to picker · Ctrl+C quit</Text>
        {results.length === 0
          ? <Text dimColor>No other indexed notes to compare.</Text>
          : results.map((hit, i) => (
              <Text key={hit.id}>
                {`${i + 1}  ${String(Math.round(hit.score * 100)).padStart(3, " ")}%  ${hit.title}  `}
                <Text dimColor>
                  {hit.kind === "section" && hit.sectionPath
                    ? `${hit.path} · ${hit.sectionPath}${hit.sourceSectionPath ? ` · via ${hit.sourceSectionPath}` : ""}`
                    : hit.sourceSectionPath
                    ? `${hit.id} · via ${hit.sourceSectionPath}`
                    : hit.id}
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
      prompt="filter> "
      promptValue={noteInput}
    >
      <Text dimColor>Type to filter · ↑↓ or j/k · Enter search · Tab cycle · Esc shell</Text>
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
