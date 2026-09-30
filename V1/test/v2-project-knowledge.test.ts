import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BROWNFIELD_CODE_MAP_DOCUMENTS, PROJECT_KNOWLEDGE_CONTRACTS, PROJECT_KNOWLEDGE_DOCUMENTS,
  ProjectKnowledge, discoverProject, projectKnowledgeCompleteness,
} from "../src/v2/project-knowledge.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
function fixture(withNamespace = true) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "project-knowledge-"))); roots.push(base);
  const root = join(base, "project"); mkdirSync(root);
  const directory = join(root, ".sol", "project"); if (withNamespace) mkdirSync(join(directory, "decisions"), { recursive: true });
  return { base, root, directory };
}
function canonical(path: keyof typeof PROJECT_KNOWLEDGE_CONTRACTS, sources: string[] = []) {
  const contract = PROJECT_KNOWLEDGE_CONTRACTS[path];
  const metadata = [`---`, `schemaVersion: 1`, `id: ${contract.id}`, `kind: ${contract.kind}`];
  if (sources.length) metadata.push("sources:", ...sources.map(source => `  - path: ${source}`));
  metadata.push("---", `# ${contract.id}`);
  return `${metadata.join("\n")}\n${contract.requiredHeadings.map(heading => `## ${heading}\nSubstantive information about ${heading.toLowerCase()}.`).join("\n")}\n`;
}

describe("v2 project knowledge", () => {
  it("discovers brownfield, greenfield, and unknown projects without reading contents", () => {
    const brown = fixture(false); mkdirSync(join(brown.root, "src"));
    writeFileSync(join(brown.root, "package.json"), "secret-content"); writeFileSync(join(brown.root, "src", "main.ts"), "secret-content");
    writeFileSync(join(brown.root, "README.md"), "secret-content"); writeFileSync(join(brown.root, "RFC-002.md"), "secret-content");
    writeFileSync(join(brown.root, ".env"), "PASSWORD=secret");
    const found = discoverProject(brown.root);
    expect(found).toMatchObject({ projectKind: "brownfield", packageManifests: ["package.json"], representativeCodePaths: ["src/main.ts"], existingGuidance: ["README.md"], candidates: ["RFC-002.md"] });
    expect(JSON.stringify(found)).not.toContain("secret-content"); expect(JSON.stringify(found)).not.toContain(".env");
    const green = fixture(false); expect(discoverProject(green.root).projectKind).toBe("greenfield");
    mkdirSync(join(green.root, "a")); mkdirSync(join(green.root, "a", "b"));
    expect(discoverProject(green.root, { maxDiscoveryDepth: 1 }).projectKind).toBe("unknown");
  });

  it("sorts and bounds discovery candidates and skips symlinks, dependencies, generated, and secrets", () => {
    const f = fixture(false); mkdirSync(join(f.root, "docs")); mkdirSync(join(f.root, "node_modules")); mkdirSync(join(f.root, "generated"));
    for (const name of ["SPEC-z.md", "ADR-a.md", "PRD-b.md"]) writeFileSync(join(f.root, "docs", name), "x");
    writeFileSync(join(f.root, "node_modules", "hidden.ts"), "x"); writeFileSync(join(f.root, "generated", "generated.ts"), "x");
    writeFileSync(join(f.root, "secret-RFC.md"), "x"); symlinkSync(join(f.root, "docs"), join(f.root, "linked"));
    const found = discoverProject(f.root, { maxDiscoveryCandidates: 2 });
    expect(found.candidates).toEqual(["docs/ADR-a.md", "docs/PRD-b.md"]); expect(found.truncated).toBe(true);
    expect(JSON.stringify(found)).not.toMatch(/hidden|generated\.ts|secret-RFC|linked/);
  });

  it("enforces every canonical document heading and metadata contract", () => {
    const f = fixture();
    for (const path of PROJECT_KNOWLEDGE_DOCUMENTS) {
      const content = canonical(path);
      writeFileSync(join(f.directory, path), path === "project.md" ? content.replace(
        "## Capabilities\nSubstantive information about capabilities.",
        "## Capabilities\n### Validated\nExisting capability evidence.\n### Current\nCurrent capability evidence.") : content);
    }
    const documents = new ProjectKnowledge(f.root).inventory({ projectKind: "greenfield", includeDecisions: false }).documents;
    for (const path of PROJECT_KNOWLEDGE_DOCUMENTS) expect(documents.find(document => document.path === path)?.quality.status, path).toBe("valid");
    writeFileSync(join(f.directory, "project.md"), "---\nschemaVersion: 2\nid: wrong\nkind: wrong\n---\n# Project\n## Purpose\nTODO\n");
    const project = new ProjectKnowledge(f.root).load(["project.md"], { projectKind: "greenfield" }).documents[0]!;
    expect(project.quality.status).toBe("invalid");
    expect(project.quality.missingHeadings).toEqual(PROJECT_KNOWLEDGE_CONTRACTS["project.md"].requiredHeadings);
  });

  it("keeps source provenance best-effort instead of blocking useful brownfield maps", () => {
    const f = fixture(); mkdirSync(join(f.root, "src")); writeFileSync(join(f.root, "src", "main.ts"), "export {}\n");
    for (const path of PROJECT_KNOWLEDGE_DOCUMENTS) writeFileSync(join(f.directory, path), canonical(path));
    const brown = new ProjectKnowledge(f.root).inventory({ projectKind: "brownfield", includeDecisions: false });
    expect(projectKnowledgeCompleteness(brown)).toMatchObject({ complete: true, degraded: expect.arrayContaining([...BROWNFIELD_CODE_MAP_DOCUMENTS]) });
    for (const path of BROWNFIELD_CODE_MAP_DOCUMENTS) writeFileSync(join(f.directory, path), canonical(path, ["src/main.ts"]));
    expect(projectKnowledgeCompleteness(new ProjectKnowledge(f.root).inventory({ projectKind: "brownfield" })).complete).toBe(true);
    rmSync(join(f.directory, "stack.md"));
    expect(projectKnowledgeCompleteness(new ProjectKnowledge(f.root).inventory({ projectKind: "greenfield" }))).toMatchObject({ complete: true, required: ["index.md", "project.md"] });
    expect(projectKnowledgeCompleteness(new ProjectKnowledge(f.root).inventory({ projectKind: "greenfield" }), { designSelected: true }).complete).toBe(true);
  });

  it("accepts mapper-style plain Markdown sources and baselines malformed optional frontmatter", () => {
    const f = fixture(); mkdirSync(join(f.root, "src")); writeFileSync(join(f.root, "src", "main.ts"), "export {};\n");
    const plain = canonical("architecture.md").replace(/^---[\s\S]*?---\n/, "")
      .replace("## Sources\nSubstantive information about sources.", "## Sources\n- `src/main.ts`");
    writeFileSync(join(f.directory, "architecture.md"), plain);
    const knowledge = new ProjectKnowledge(f.root), architecture = knowledge.load(["architecture.md"], { projectKind: "brownfield" }).documents[0]!;
    expect(architecture).toMatchObject({ quality: { status: "valid" }, metadata: { sources: [{ path: "src/main.ts" }] } });
    expect(architecture.freshness?.sources[0]).toMatchObject({ path: "src/main.ts", status: "untracked" });

    const malformed = `---\nfocus: tech\nread_scope:\n  - src/**\n---\n${canonical("stack.md").replace(/^---[\s\S]*?---\n/, "")
      .replace("## Sources\nSubstantive information about sources.", "## Sources\n- `src/main.ts`")}`;
    writeFileSync(join(f.directory, "stack.md"), malformed);
    expect(knowledge.load(["stack.md"], { projectKind: "brownfield" }).documents[0]?.quality.status).toBe("degraded");
    expect(knowledge.captureBaseline(["architecture.md", "stack.md"])).toMatchObject({ omitted: [], baseline: { documents: [
      { path: "architecture.md", sources: [{ path: "src/main.ts" }] }, { path: "stack.md", sources: [{ path: "src/main.ts" }] },
    ] } });
  });

  it("accepts path-only or hashed sources and explicit absence statements", () => {
    const f = fixture(); mkdirSync(join(f.root, "src")); writeFileSync(join(f.root, "src", "main.ts"), "export {}\n");
    const text = canonical("integrations.md", ["src/main.ts"]).replace(/Substantive information about external services\./, "Not detected.");
    writeFileSync(join(f.directory, "integrations.md"), text);
    const document = new ProjectKnowledge(f.root).load(["integrations.md"], { projectKind: "brownfield" }).documents[0]!;
    expect(document.quality.status).toBe("valid"); expect(document.freshness?.sources[0]).toMatchObject({ path: "src/main.ts", status: "untracked", currentHash: digest("export {}\n") });
  });

  it("preserves legacy and manual docs while surfacing degraded quality and malformed metadata", () => {
    const f = fixture(); writeFileSync(join(f.directory, "business.md"), "# Business context\nWritten by hand.\n");
    writeFileSync(join(f.directory, "patterns.md"), "---\nschemaVersion: nope\n---\n# Patterns\nUseful prose.\n");
    const loaded = new ProjectKnowledge(f.root).load(["business.md", "patterns.md"]);
    expect(loaded.documents[0]).toMatchObject({ prose: "# Business context\nWritten by hand.\n", quality: { status: "degraded" } });
    expect(loaded.documents[1]?.diagnostics).toContainEqual(expect.objectContaining({ code: "malformed-metadata" }));
  });

  it("captures trusted hashes and reports changed, deleted, and shared affected sources", () => {
    const f = fixture(); mkdirSync(join(f.root, "src")); writeFileSync(join(f.root, "src", "shared.ts"), "one\n");
    writeFileSync(join(f.directory, "architecture.md"), canonical("architecture.md", ["src/shared.ts"]));
    writeFileSync(join(f.directory, "testing.md"), canonical("testing.md", ["src/shared.ts"]));
    const knowledge = new ProjectKnowledge(f.root); const capture = knowledge.captureBaseline(["architecture.md", "testing.md"]);
    expect(capture.baseline.documents).toHaveLength(2); expect(capture.baseline.documents[0]?.sources[0]?.sha256).toBe(digest("one\n"));
    writeFileSync(join(f.root, "src", "shared.ts"), "two\n"); rmSync(join(f.directory, "testing.md"));
    const compared = knowledge.compareBaseline(capture.baseline);
    expect(compared.status).toBe("changed");
    expect(compared.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "source-changed", affectedDocumentIds: ["architecture", "testing"] }),
      expect.objectContaining({ kind: "document-deleted", affectedDocumentIds: ["testing"] }),
    ]));
  });

  it("rejects unsafe source paths and never follows document, source, or namespace symlinks", () => {
    const f = fixture(); const outside = join(f.base, "outside.md"); writeFileSync(outside, "outside secret");
    symlinkSync(outside, join(f.directory, "index.md")); symlinkSync(outside, join(f.root, "linked.ts"));
    writeFileSync(join(f.directory, "architecture.md"), canonical("architecture.md", ["linked.ts"]));
    const result = new ProjectKnowledge(f.root).load(["index.md", "architecture.md"], { projectKind: "brownfield" });
    expect(result.documents.map(document => document.path)).toEqual(["architecture.md"]);
    expect(result.diagnostics.map(entry => entry.code)).toEqual(expect.arrayContaining(["symlink", "unsafe-source"]));
    expect(JSON.stringify(result)).not.toContain("outside secret");
  });

  it("enforces document, aggregate, source, and decision bounds with omissions", () => {
    const f = fixture(); writeFileSync(join(f.directory, "index.md"), "12345"); writeFileSync(join(f.directory, "project.md"), "67890");
    writeFileSync(join(f.directory, "stack.md"), "x".repeat(11));
    const result = new ProjectKnowledge(f.root, { maxDocumentBytes: 10, maxTotalBytes: 7 }).load(["index.md", "project.md", "stack.md"]);
    expect(result.documents.map(document => document.path)).toEqual(["index.md"]); expect(result.omitted).toEqual(["project.md", "stack.md"]);
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "budget" }), expect.objectContaining({ code: "oversized" })]));
  });
});
