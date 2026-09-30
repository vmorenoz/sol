import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SolCore, planTemplates, type EvidenceRecord } from "../src/v2/core.js";
import { EvidenceRunner, fingerprint } from "../src/v2/evidence.js";

const dirs: string[] = [], cores: SolCore[] = [];
afterEach(() => { cores.splice(0).forEach((core) => core.close()); dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })); });
const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
const node = (script: string): string => `${quote(process.execPath)} -e ${quote(script)}`;
function setup(script: string, timeoutMs = 3000, checks = true, environment?: { prepare?: { command: string; timeoutMs?: number }; generatedOutputs: string[] }) {
  const base = mkdtempSync(join(tmpdir(), "v2-evidence-")); dirs.push(base);
  const root = join(base, "project"); mkdirSync(root); writeFileSync(join(root, "source.js"), "original");
  const core = new SolCore(root, ":memory:"); cores.push(core);
  const draft = planTemplates.fast(); draft.tasks[0]!.reads = ["source.js", "src/**"];
  draft.tasks[0]!.checks = checks ? [{ id: "test", command: node(script), timeoutMs }] : [];
  if (environment) draft.tasks[0]!.environment = environment;
  const plan = core.createPlan(draft);
  const attempt = core.leaseAttempt(plan.id, "work", { workspacePath: root, snapshotId: "baseline", isolated: false });
  core.startAttempt(attempt.id, "session");
  const storage = join(base, "artifacts"), runner = new EvidenceRunner(core, storage);
  return { root, core, attempt, runner, storage };
}
function submit(core: SolCore, attemptId: string, evidence: EvidenceRecord[]): void {
  core.submitResult(attemptId, { schemaVersion: 2, outcome: "completed", summary: "Ready for trusted verification",
    criteria: [{ id: "done", status: "satisfied", evidenceRefs: evidence.map(entry => entry.id) }], findings: [], blockers: [], artifacts: [] });
}
function merged(root: string, source = "original"): string {
  const directory = join(dirname(root), "merged"); mkdirSync(directory);
  writeFileSync(join(directory, "source.js"), source); return directory;
}

describe('Flutter output fingerprints', () => {
  it('accepts a check creating external Flutter dependency links and verifies current evidence', async () => {
    const script = `const fs = require('node:fs'); const path = require('node:path');
      fs.mkdirSync('ios/Flutter/ephemeral/Packages/.packages', {recursive:true});
      fs.symlinkSync(path.resolve('../dependency'), 'ios/Flutter/ephemeral/Packages/.packages/app_links-7.2.1');`;
    const { root, runner, attempt } = setup(script);
    mkdirSync(join(dirname(root), 'dependency'));
    writeFileSync(join(dirname(root), 'dependency/plugin.dart'), 'untouched');
    const evidence = await runner.run(attempt.id, 'test');
    expect(evidence.exitCode).toBe(0);
    expect(() => runner.verifyCurrent(attempt.id)).not.toThrow();
    expect(readFileSync(join(dirname(root), 'dependency/plugin.dart'), 'utf8')).toBe('untouched');
  });

  it('protects tracked Flutter files in an unmanaged git fingerprint', () => {
    const { root } = setup('');
    const file = join(root, 'macos/Flutter/ephemeral/input.txt');
    mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, 'input');
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['add', '.'], { cwd: root });
    const before = fingerprint(root);
    writeFileSync(file, 'changed');
    expect(fingerprint(root)).not.toBe(before);
  });
});

describe("trusted native webfetch observations", () => {
  it("supports a read-only researcher citing actual host-retrieved content as historical evidence", () => {
    const { core, root, runner, attempt: old } = setup("", 3000, false);
    core.failAttempt(old.id, "Release fixture reservation", false);
    const plan = core.createPlan(planTemplates.investigation());
    const attempt = core.leaseAttempt(plan.id, "work", { workspacePath: root, snapshotId: "research", isolated: false });
    core.startAttempt(attempt.id, "research-session");
    const content = "# Public documentation\nThe API returns a promise.";
    const evidence = runner.observeExternal(attempt.id, "https://docs.example.org/api?version=2&q=promises#usage", content);
    expect(evidence.kind).toBe("inspection"); expect(evidence.command).toBeUndefined();
    expect(evidence.artifactPath).toMatch(/^references\//); expect(evidence.summary).toContain("truth not verified");
    expect(evidence.summary).not.toContain(content);
    const reference = runner.readExternalReference(evidence);
    expect(reference).toMatchObject({ origin: "native-webfetch", attemptId: attempt.id, snapshotId: "research",
      url: "https://docs.example.org/api?version=2&q=promises", excerpt: content, truncated: false,
      contentHash: createHash("sha256").update(content).digest("hex"), contentBytes: Buffer.byteLength(content) });
    expect(Number.isFinite(Date.parse(reference.observedAt))).toBe(true);
    submit(core, attempt.id, [evidence]);
    // Historical remote evidence does not depend on local source edits or another HTTP request.
    writeFileSync(join(root, "source.js"), "unrelated edit");
    expect(() => runner.verifyCurrent(attempt.id)).not.toThrow();
    core.acceptAttempt(attempt.id);
    expect(core.getAttempt(attempt.id).status).toBe("succeeded");
  });
  it("rejects non-HTTPS, credential-bearing and sensitive-query URLs before recording evidence", () => {
    const { core, runner, attempt } = setup("", 3000, false);
    for (const url of ["http://example.org", "file:///tmp/doc", "https://user:password@example.org/doc",
      "https://user@example.org", "https://example.org?TOKEN=x", "https://example.org?api_key=x",
      "https://example.org?password=x", "https://example.org?X-Amz-Signature=x", "https://example.org?access_token=x",
      "https://example.org?%6bey=x", "https://example.org?sig=x"]) {
      expect(() => runner.observeExternal(attempt.id, url, "retrieved source")).toThrow();
    }
    expect(core.listEvidence(attempt.id)).toEqual([]);
  });
  it("bounds the entire JSON capture, explicitly truncates and hashes the full Unicode/escaped content", () => {
    const { core, runner, attempt, storage } = setup("", 3000, false);
    const content = '😀\n"\\'.repeat(250000);
    const evidence = runner.observeExternal(attempt.id, "https://docs.example.org/large", content);
    const artifact = readFileSync(join(storage, evidence.artifactPath!));
    expect(artifact.length).toBeLessThanOrEqual(1024 * 1024);
    const reference = runner.readExternalReference(evidence);
    expect(reference.truncated).toBe(true); expect(reference.excerptBytes).toBeLessThan(reference.contentBytes);
    expect(content.startsWith(reference.excerpt)).toBe(true);
    expect(reference.contentBytes).toBe(Buffer.byteLength(content));
    expect(reference.contentHash).toBe(createHash("sha256").update(content).digest("hex"));
    submit(core, attempt.id, [evidence]);
    expect(() => new EvidenceRunner(core, storage).verifyCurrent(attempt.id)).not.toThrow();
    const corrupted = { ...reference, contentHash: "0".repeat(64) };
    writeFileSync(join(storage, evidence.artifactPath!), JSON.stringify(corrupted));
    expect(() => runner.verifyCurrent(attempt.id)).toThrow(/digest mismatch/);
  });
  it("rejects tampered origin, attempt, URL, timestamp, or excerpt metadata", () => {
    const { core, runner, attempt, storage } = setup("", 3000, false);
    const evidence = runner.observeExternal(attempt.id, "https://docs.example.org/doc", "Actual retrieved text");
    const reference = runner.readExternalReference(evidence);
    submit(core, attempt.id, [evidence]);
    for (const change of [{ origin: "model" }, { attemptId: "other" }, { url: "https://other.example.org" },
      { observedAt: "2020-01-01T00:00:00.000Z" }, { excerpt: "Invented text" }]) {
      writeFileSync(join(storage, evidence.artifactPath!), JSON.stringify({ ...reference, ...change }));
      expect(() => runner.verifyCurrent(attempt.id)).toThrow(/digest mismatch/);
    }
  });
  it("rejects reuse of an intact reference by a different attempt", () => {
    const { core, root, runner, attempt } = setup("", 3000, false);
    const evidence = runner.observeExternal(attempt.id, "https://docs.example.org/doc", "Observed text");
    core.failAttempt(attempt.id, "Release first attempt", false);
    const plan = core.createPlan(planTemplates.investigation());
    const other = core.leaseAttempt(plan.id, "work", { workspacePath: root, snapshotId: "baseline", isolated: false });
    core.startAttempt(other.id, "other-session");
    const forged = core.recordEvidence(other.id, { kind: "inspection", snapshotId: "baseline", summary: evidence.summary, artifactPath: evidence.artifactPath });
    submit(core, other.id, [forged]);
    expect(() => runner.verifyCurrent(other.id)).toThrow(/provenance/);
  });
});

describe("v2 named command evidence", () => {
  it("records failed preparation separately and never starts the named check", async () => {
    const s = setup('require("fs").writeFileSync("check-started", "bad")', 3000, true, {
      generatedOutputs: [], prepare: { command: node('console.log("missing local runner specification"); process.exit(7)') },
    });
    let failure: unknown;
    try { await s.runner.run(s.attempt.id, "test"); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ name: "EnvironmentPreparationError", preparation: { actualExitCode: 7, valid: false } });
    const artifact = (failure as { preparation: { artifactPath: string } }).preparation.artifactPath;
    expect(readFileSync(join(s.storage, artifact), "utf8")).toContain("missing local runner specification");
    expect(JSON.parse(readFileSync(join(s.storage, `${artifact}.json`), "utf8"))).toMatchObject({ attemptId: s.attempt.id, valid: false });
    expect(s.core.listEvidence(s.attempt.id)).toEqual([]);
    expect(existsSync(join(s.root, "check-started"))).toBe(false);
  });

  it("caches successful preparation only for the same effective source and manifest", async () => {
    const s = setup('require("./node_modules/test-runner")', 3000, true, {
      generatedOutputs: [], prepare: { command: node('const fs=require("fs"); fs.mkdirSync("node_modules",{recursive:true}); fs.writeFileSync("node_modules/test-runner.js", "module.exports="+JSON.stringify(fs.readFileSync("package.lock","utf8"))); console.log("prepared")') },
    });
    writeFileSync(join(s.root, "package.lock"), "v1");
    const first = await s.runner.prepare(s.attempt.id);
    expect(first?.artifactPath).toMatch(/^preparations\//);
    expect(await s.runner.prepare(s.attempt.id)).toBeUndefined();
    expect((await s.runner.run(s.attempt.id, "test")).exitCode).toBe(0);
    writeFileSync(join(s.root, "package.lock"), "v2");
    expect((await s.runner.prepare(s.attempt.id))?.artifactPath).not.toBe(first?.artifactPath);
    expect(readFileSync(join(s.root, "node_modules/test-runner.js"), "utf8")).toContain("v2");
    writeFileSync(join(s.root, "source.js"), "changed source");
    expect(await s.runner.prepare(s.attempt.id)).toBeDefined();
  });

  it.each(["source.js", "src/input.js", "dist/tracked.js"])("output declarations cannot hide existing input mutation: %s", async file => {
    const s = setup(`require("fs").writeFileSync(${JSON.stringify(file)}, "mutated")`, 3000, true, { generatedOutputs: ["**"] });
    mkdirSync(dirname(join(s.root, file)), { recursive: true }); writeFileSync(join(s.root, file), "baseline");
    expect((await s.runner.run(s.attempt.id, "test")).exitCode).not.toBe(0);
    expect(() => s.runner.verifyCurrent(s.attempt.id)).toThrow();
  });

  it("keeps full hashes for preexisting deliverables after a successful check", async () => {
    const s = setup("", 3000, true, { generatedOutputs: ["dist/**"] });
    mkdirSync(join(s.root, "dist")); writeFileSync(join(s.root, "dist/output.js"), "delivered");
    expect((await s.runner.run(s.attempt.id, "test")).exitCode).toBe(0);
    writeFileSync(join(s.root, "dist/output.js"), "mutated after pass");
    expect(() => s.runner.verifyCurrent(s.attempt.id)).toThrow(/Stale check/);
  });

  it("rejects a symlink used as a declared generated directory", async () => {
    const s = setup('require("fs").symlinkSync("src", "dist")', 3000, true, { generatedOutputs: ["dist/**"] });
    mkdirSync(join(s.root, "src")); writeFileSync(join(s.root, "src/input.js"), "input");
    await expect(s.runner.run(s.attempt.id, "test")).rejects.toThrow(/symlink/);
  });

  it("executes only named checks and keeps bounded raw logs outside the project", async () => {
    const { runner, attempt, storage } = setup('process.stdout.write("secret".repeat(300000))');
    await expect(runner.run(attempt.id, "arbitrary command")).rejects.toThrow(/Unknown/);
    const record = await runner.run(attempt.id, "test");
    expect(record.exitCode).toBe(0); expect(record.durationMs).toBeGreaterThan(0);
    expect(record.snapshotId).toBe("baseline"); expect(record.artifactPath).toMatch(/^checks\//);
    expect(record.summary).not.toContain("secret");
    expect(readFileSync(join(storage, record.artifactPath!)).length).toBe(1024 * 1024);
    expect(runner.readLedger(record).actualExitCode).toBe(0);
    expect(() => runner.verifyCurrent(attempt.id)).not.toThrow();
  });
  it("records real failures and timeout elapsed time", async () => {
    const failed = setup("process.exit(7)");
    expect((await failed.runner.run(failed.attempt.id, "test")).exitCode).toBe(7);
    const timeout = setup("setTimeout(() => {}, 10000)", 100);
    const record = await timeout.runner.run(timeout.attempt.id, "test");
    expect(record.exitCode).not.toBe(0); expect(record.durationMs).toBeGreaterThanOrEqual(100);
    expect(timeout.runner.readLedger(record).timedOut).toBe(true);
    expect(() => timeout.runner.verifyCurrent(timeout.attempt.id)).toThrow(/failed/);
  });
  it("invalidates self-modifying checks and allows a stable retry", async () => {
    const { runner, attempt } = setup('require("node:fs").writeFileSync("source.js", "updated")');
    const first = await runner.run(attempt.id, "test");
    expect(first.exitCode).not.toBe(0); expect(first.summary).toContain("source changed");
    expect(runner.readLedger(first).actualExitCode).toBe(0);
    expect((await runner.run(attempt.id, "test")).exitCode).toBe(0);
    expect(() => runner.verifyCurrent(attempt.id)).not.toThrow();
  });
  it("rejects changes after success and a later failed check", async () => {
    const { runner, attempt, root } = setup('process.exit(require("node:fs").readFileSync("source.js", "utf8") === "original" ? 0 : 5)');
    await runner.run(attempt.id, "test");
    writeFileSync(join(root, "source.js"), "changed");
    expect(() => runner.verifyCurrent(attempt.id)).toThrow(/Stale/);
    await runner.run(attempt.id, "test"); writeFileSync(join(root, "source.js"), "original");
    expect(() => runner.verifyCurrent(attempt.id)).toThrow(/failed/);
  });
  it("handles pre-abort without executing and rejects in-project storage", async () => {
    const { runner, attempt, core, root } = setup('require("node:fs").writeFileSync("source.js", "bad")');
    const controller = new AbortController(); controller.abort();
    const record = await runner.run(attempt.id, "test", { signal: controller.signal });
    expect(record.exitCode).not.toBe(0); expect(readFileSync(join(root, "source.js"), "utf8")).toBe("original");
    expect(() => new EvidenceRunner(core, join(root, "logs"))).toThrow(/outside/);
    expect(() => fingerprint("/")).toThrow(/root/);
  });
  it("aborts a running process and terminates Unix descendants on timeout", async () => {
    const running = setup("setTimeout(() => {}, 10000)");
    const controller = new AbortController();
    const pending = running.runner.run(running.attempt.id, "test", { signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    const aborted = await pending;
    expect(running.runner.readLedger(aborted).aborted).toBe(true);
    expect(aborted.exitCode).not.toBe(0);
    if (process.platform === "win32") return;
    const child = 'setTimeout(() => require("node:fs").writeFileSync("late.txt", "escaped"), 600)';
    const group = setup(`require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(child)}], {stdio: "inherit"}); setTimeout(() => {}, 10000)`, 200);
    const record = await group.runner.run(group.attempt.id, "test");
    expect(group.runner.readLedger(record).timedOut).toBe(true);
    await new Promise((done) => setTimeout(done, 650));
    expect(existsSync(join(group.root, "late.txt"))).toBe(false);
  });
  it("fingerprints tracked, ignored, generated and lock files; excludes only hard caches/secrets", () => {
    const { root } = setup("process.exit(0)");
    execFileSync("git", ["init", root], { stdio: "ignore" });
    writeFileSync(join(root, ".gitignore"), "ignored.txt\n");
    execFileSync("git", ["-C", root, "add", "source.js", ".gitignore"]);
    const initial = fingerprint(root);
    writeFileSync(join(root, "ignored.txt"), "ignored"); expect(fingerprint(root)).not.toBe(initial);
    for (const dir of ["dist", "build", "target"]) {
      const before = fingerprint(root); mkdirSync(join(root, dir)); writeFileSync(join(root, dir, "output"), "generated");
      expect(fingerprint(root)).not.toBe(before);
      execFileSync("git", ["-C", root, "add", `${dir}/output`]);
      const tracked = fingerprint(root); writeFileSync(join(root, dir, "output"), "tracked change");
      expect(fingerprint(root)).not.toBe(tracked);
    }
    const beforeCaches = fingerprint(root);
    for (const dir of ["node_modules", ".cache", ".yarn", ".venv", "__pycache__", ".aws"]) {
      mkdirSync(join(root, dir)); writeFileSync(join(root, dir, "file"), "ignored");
    }
    for (const file of [".env", ".env.local", "credentials.json", "private.pem", ".npmrc"]) writeFileSync(join(root, file), "secret");
    expect(fingerprint(root)).toBe(beforeCaches);
    writeFileSync(join(root, ".env.example"), "example"); expect(fingerprint(root)).not.toBe(beforeCaches);
    writeFileSync(join(root, "package-lock.json"), "lock"); expect(fingerprint(root)).not.toBe(initial);
    const lock = fingerprint(root); writeFileSync(join(root, "source.js"), "dirty"); expect(fingerprint(root)).not.toBe(lock);
  });
  it("invalidates successful evidence when ignored or generated files change", async () => {
    const { root, runner, attempt } = setup("process.exit(0)");
    execFileSync("git", ["init", root], { stdio: "ignore" });
    writeFileSync(join(root, ".gitignore"), "ignored.txt\ndist/\n");
    await runner.run(attempt.id, "test");
    writeFileSync(join(root, "ignored.txt"), "integrable");
    expect(() => runner.verifyCurrent(attempt.id)).toThrow(/Stale/);
    await runner.run(attempt.id, "test");
    mkdirSync(join(root, "dist")); writeFileSync(join(root, "dist", "out.js"), "generated");
    expect(() => runner.verifyCurrent(attempt.id)).toThrow(/Stale/);
  });
  it("fails checks that generate ignored output until a stable retry", async () => {
    const { root, runner, attempt } = setup('require("node:fs").writeFileSync("ignored.txt", "output")');
    execFileSync("git", ["init", root], { stdio: "ignore" }); writeFileSync(join(root, ".gitignore"), "ignored.txt\n");
    expect((await runner.run(attempt.id, "test")).exitCode).not.toBe(0);
    expect((await runner.run(attempt.id, "test")).exitCode).toBe(0);
  });
});

describe("source observations", () => {
  it("captures full source and workspace hashes without claiming verification; ignores unrelated edits", () => {
    const { root, runner, attempt, core } = setup("", 3000, false);
    writeFileSync(join(root, "source.js"), "a".repeat(20000));
    const evidence = runner.observe(attempt.id, "source.js", "The implementation handles errors");
    expect(evidence.kind).toBe("inspection"); expect(evidence.summary).toContain("not verified");
    const ledger = runner.readObservation(evidence);
    expect(ledger.sourceHash).toMatch(/^[a-f0-9]{64}$/); expect(ledger.workspaceFingerprint).toBe(fingerprint(root));
    submit(core, attempt.id, [evidence]);
    writeFileSync(join(root, "unrelated.js"), "unrelated");
    expect(() => runner.verifyCurrent(attempt.id)).not.toThrow();
    writeFileSync(join(root, "source.js"), "a".repeat(19999) + "b");
    expect(() => runner.verifyCurrent(attempt.id)).toThrow(/Stale observation/);
  });
  it("rejects unsafe, out-of-scope, oversized and secret observation sources", () => {
    const { root, runner, attempt } = setup("", 3000, false);
    const outside = join(dirname(root), "outside.js"); writeFileSync(outside, "outside");
    mkdirSync(join(root, "src")); symlinkSync(outside, join(root, "src", "escape.js"));
    writeFileSync(join(root, "other.js"), "other"); writeFileSync(join(root, "src", ".env"), "secret");
    for (const path of ["../outside.js", outside, "other.js", "src/escape.js", "src/.env", "src"]) {
      expect(() => runner.observe(attempt.id, path, "claim")).toThrow();
    }
    writeFileSync(join(root, "source.js"), Buffer.alloc(1024 * 1024 + 1));
    expect(() => runner.observe(attempt.id, "source.js", "claim")).toThrow(/1 MiB/);
  });
  it("checks only referenced observations and rejects missing or artifactless runner proof", () => {
    const { root, runner, attempt, core, storage } = setup("", 3000, false);
    runner.observe(attempt.id, "source.js", "Older observation");
    writeFileSync(join(root, "source.js"), "new");
    const evidence = runner.observe(attempt.id, "source.js", "Current observation");
    submit(core, attempt.id, [evidence]);
    expect(() => runner.verifyCurrent(attempt.id)).not.toThrow();
    rmSync(join(storage, evidence.artifactPath!)); expect(() => runner.verifyCurrent(attempt.id)).toThrow();
    const legacy = setup("", 3000, false);
    const inspection = legacy.core.recordEvidence(legacy.attempt.id, { kind: "inspection", snapshotId: "baseline", summary: "Trusted legacy inspection" });
    submit(legacy.core, legacy.attempt.id, [inspection]);
    expect(() => legacy.runner.verifyCurrent(legacy.attempt.id)).toThrow(/Missing observation artifact/);
  });
});

describe("isolated merged-tree verification", () => {
  it("detects merge failures independently of worker success without changing core evidence", async () => {
    const { core, root, runner, attempt } = setup('process.exit(require("node:fs").readFileSync("source.js", "utf8") === "original" ? 0 : 9)');
    const evidence = await runner.run(attempt.id, "test"); expect(evidence.exitCode).toBe(0);
    submit(core, attempt.id, [evidence]);
    const directory = merged(root, "merged regression");
    const receipt = await runner.verifyIntegration(attempt.id, directory);
    expect(receipt.passed).toBe(false); expect(receipt.artifactPath).toMatch(/^integrations\//);
    const report = runner.readIntegrationReport(receipt.artifactPath);
    expect(report.checks[0]?.actualExitCode).toBe(9); expect(report.checks[0]?.durationMs).toBeGreaterThan(0);
    expect(report.snapshotId).toBe("baseline"); expect(report.baselineEvidenceIds).toEqual([evidence.id]);
    expect(core.listEvidence(attempt.id)).toEqual([evidence]); expect(core.getAttempt(attempt.id).status).toBe("submitted");
    writeFileSync(join(directory, "source.js"), "original");
    expect((await runner.verifyIntegration(attempt.id, directory)).passed).toBe(true);
    await expect(runner.verifyIntegration(attempt.id, root)).rejects.toThrow(/isolated/);
  });
  it("rejects merged-tree mutation, timeout, and abort", async () => {
    for (const mode of ["mutation", "timeout", "abort"] as const) {
      const script = mode === "mutation" ? 'require("node:fs").writeFileSync("ignored.txt", "output")' : "setTimeout(() => {}, 10000)";
      const fixture = setup(script, mode === "timeout" ? 100 : 3000);
      const proof = fixture.runner.observe(fixture.attempt.id, "source.js", "Observed input");
      submit(fixture.core, fixture.attempt.id, [proof]);
      const controller = new AbortController(); if (mode === "abort") controller.abort();
      const receipt = await fixture.runner.verifyIntegration(fixture.attempt.id, merged(fixture.root), { signal: controller.signal });
      expect(receipt.passed).toBe(false);
      const report = fixture.runner.readIntegrationReport(receipt.artifactPath);
      if (mode === "mutation") expect(report.before).not.toBe(report.after);
      if (mode === "timeout") expect(report.checks[0]?.timedOut).toBe(true);
      if (mode === "abort") expect(report.checks[0]?.aborted).toBe(true);
    }
  });
  it("returns an explicit receipt when no executable checks are declared", async () => {
    const { core, root, runner, attempt } = setup("", 3000, false);
    const proof = runner.observe(attempt.id, "source.js", "Observed input"); submit(core, attempt.id, [proof]);
    const receipt = await runner.verifyIntegration(attempt.id, merged(root));
    expect(receipt.passed).toBe(true); expect(receipt.summary).toContain("No executable checks");
    expect(runner.readIntegrationReport(receipt.artifactPath).checks).toEqual([]);
  });
});
