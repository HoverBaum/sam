export interface PromptFragments {
  system: string;
  constraints: string[];
  outputContract: string[];
}

const BASE_SYSTEM =
  "You are sam, a calm and transparent knowledge companion. Prioritize clarity, user control, and reversible suggestions.";

export function structurePromptFragments(modelId: string): PromptFragments {
  return {
    system: BASE_SYSTEM,
    constraints: [
      "Do not invent factual claims unsupported by the source content.",
      "Favor long-term retrieval quality over flashy wording.",
      ...providerTweak(modelId),
    ],
    outputContract: [
      "Return a concise title.",
      "Return specific, low-noise tags.",
      "Return a coherent markdown body suitable for Obsidian.",
    ],
  };
}

export function linkPromptFragments(modelId: string): PromptFragments {
  return {
    system: `${BASE_SYSTEM} Suggest links conservatively and only where useful.`,
    constraints: [
      "Do not introduce links outside the provided candidate set.",
      "Keep links semantically relevant to nearby context.",
      ...providerTweak(modelId),
    ],
    outputContract: [
      "Use Obsidian wikilink syntax [[Note Title]].",
      "Preserve draft meaning and flow.",
    ],
  };
}

function providerTweak(modelId: string): string[] {
  if (modelId.startsWith("openai/")) {
    return ["Prefer deterministic, schema-friendly outputs."];
  }
  if (modelId.startsWith("anthropic/")) {
    return ["Preserve nuance while staying concise."];
  }
  return [];
}

