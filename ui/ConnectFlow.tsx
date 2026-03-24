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

const TOP_K = 5;
const SUGGEST_CAP = 10;

export interface ConnectFlowProps {
  context: CommandContext;
  onExit: () => void;
}

type Phase = "pick" | "loading" | "results" | "error" | "empty";

export function ConnectFlow({ context, onExit }: ConnectFlowProps) {
  const { exit } = useApp();
  const [phase, setPhase] = useState<Phase>("pick");
  const [noteInput, setNoteInput] = useState("");
  const [indexedPaths, setIndexedPaths] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [results, setResults] = useState<NeighborHit[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);

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
      const run = async () => {
        setRunError(null);
        const dir = await resolveActiveProfileDir(context.config);
        const store = await readStore(dir);
        const resolved = resolvePickedNotePath(noteInput, indexedPaths, store);
        if (!resolved) {
          setRunError("Pick a note: Tab to cycle matches, or type the full vault path, then Enter.");
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
      void run();
      return;
    }

    if (key.tab && suggestions.length > 0) {
      const next = suggestions[autocompleteIndex % suggestions.length];
      setNoteInput(next);
      setAutocompleteIndex((i) => (i + 1) % suggestions.length);
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

  if (phase === "empty") {
    return (
      <Box flexDirection="column">
        <Text color="cyan">Similar notes</Text>
        <Text dimColor>
          No indexed notes yet. Run sam index first, then try again. Enter or Esc to go back.
        </Text>
      </Box>
    );
  }

  if (phase === "error" && loadError) {
    return (
      <Box flexDirection="column">
        <Text color="red">Could not load index: {loadError}</Text>
        <Text dimColor>Press Enter or Esc to go back.</Text>
      </Box>
    );
  }

  if (phase === "loading") {
    return (
      <Box>
        <Text color="green">
          <Spinner type="dots" />
        </Text>
        <Text> Finding kindred notes…</Text>
      </Box>
    );
  }

  if (phase === "results") {
    return (
      <Box flexDirection="column">
        <Text color="cyan">Similar notes (cosine similarity)</Text>
        <Text dimColor>Esc back to picker · Ctrl+C quit</Text>
        {results.length === 0
          ? <Text dimColor>No other indexed notes to compare.</Text>
          : results.map((hit, i) => (
            <Text key={hit.id}>
              {`${i + 1}  ${String(Math.round(hit.score * 100)).padStart(3, " ")}%  ${hit.title}  `}
              <Text dimColor>{hit.id}</Text>
            </Text>
          ))}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="cyan">Similar notes</Text>
      <Text dimColor>Tab cycles matches · Enter to search · Esc back to shell</Text>
      {runError ? <Text color="yellow">{runError}</Text> : null}
      <Box marginTop={1}>
        <Text>Note&gt; {noteInput}</Text>
      </Box>
      {suggestions.length > 0
        ? (
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>Suggestions:</Text>
            {suggestions.slice(0, 5).map((p) => (
              <Text key={p}>
                <Text>{basename(p).replace(/\.md$/, "")}</Text>
                <Text dimColor>{"  ←  "}{p}</Text>
              </Text>
            ))}
          </Box>
        )
        : noteInput.trim().length > 0
        ? <Text dimColor>No matches — keep typing or paste a full path.</Text>
        : null}
    </Box>
  );
}
