import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentPaths, getProjectRoot } from "./workspace.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PROVIDER_TEMPLATE_DIR = path.resolve(
  __dirname,
  "..",
  "templates",
  "providers",
);

const PROVIDER_MAP = {
  opencode: { template: "opencode.md", output: "AGENTS.md" },
  claude: { template: "claude.md", output: "CLAUDE.md" },
  openclaude: { template: "openclaude.md", output: "OPENCLAUDE.md" },
  gemini: { template: "gemini.md", output: "GEMINI.md" },
  copilot: { template: "copilot.md", output: "COPILOT.md" },
  antigravity: { template: "antigravity.md", output: "ANTIGRAVITY.md" },
};

export const SUPPORTED_PROVIDERS = Object.keys(PROVIDER_MAP);

export function getSupportedProviders() {
  return [...SUPPORTED_PROVIDERS];
}

export function getProviderOutputFilename(provider) {
  const entry = PROVIDER_MAP[provider];
  return entry ? entry.output : null;
}

export function initProviderFile(provider, rootDir = getProjectRoot()) {
  const entry = PROVIDER_MAP[provider];
  if (!entry) {
    return {
      success: false,
      error: `unsupported provider: ${provider}. Supported: ${SUPPORTED_PROVIDERS.join(", ")}`,
    };
  }

  const templatePath = path.join(PROVIDER_TEMPLATE_DIR, entry.template);
  if (!fs.existsSync(templatePath)) {
    return { success: false, error: `template not found: ${templatePath}` };
  }

  const outputPath = path.join(rootDir, entry.output);
  const profile = loadProjectProfile(rootDir);

  let template = fs.readFileSync(templatePath, "utf8");
  template = interpolate(template, profile);

  fs.writeFileSync(outputPath, template);

  return {
    success: true,
    provider,
    outputFile: entry.output,
    outputPath,
  };
}

export function initAllProviders(rootDir = getProjectRoot()) {
  const results = [];
  for (const provider of SUPPORTED_PROVIDERS) {
    const result = initProviderFile(provider, rootDir);
    results.push(result);
  }
  return results;
}

function loadProjectProfile(rootDir = getProjectRoot()) {
  const paths = getAgentPaths(rootDir);
  const protocolPath = path.join(paths.agentRoot, "PROTOCOL.md");

  const defaults = {
    project: path.basename(rootDir),
    language: ["typescript", "javascript"],
    runtime: "node",
  };

  if (!fs.existsSync(protocolPath)) return defaults;

  try {
    const content = fs.readFileSync(protocolPath, "utf8");
    const profile = { ...defaults };

    const nameMatch = content.match(/- \*\*Project\*\*: (.+)/);
    if (nameMatch) profile.project = nameMatch[1].trim();

    const langMatch = content.match(/- \*\*Languages\*\*: (.+)/);
    if (langMatch)
      profile.language = langMatch[1].split(",").map((l) => l.trim());

    const runtimeMatch = content.match(/- \*\*Runtime\*\*: (.+)/);
    if (runtimeMatch) profile.runtime = runtimeMatch[1].trim();

    return profile;
  } catch {
    return defaults;
  }
}

function interpolate(template, profile) {
  return template
    .replace(/\{\{PROJECT_NAME\}\}/g, profile.project || "my-app")
    .replace(
      /\{\{LANGUAGES\}\}/g,
      Array.isArray(profile.language)
        ? profile.language.join(", ")
        : profile.language || "unknown",
    )
    .replace(/\{\{RUNTIME\}\}/g, profile.runtime || "node");
}
