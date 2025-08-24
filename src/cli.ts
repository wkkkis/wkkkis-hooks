import prompts from "prompts";
import fs from "node:fs";
import path from "node:path";

if (typeof (globalThis as any).fetch !== "function") {
  console.error("Node 18+ required: global fetch() not found.");
  process.exit(1);
}

const REGISTRY_URL =
  "https://raw.githubusercontent.com/wkkkis/hooks-registry/main/registry.json";

const CONFIG_FILE = "hooks.config.json";

type ProjectConfig = {
  baseDir: string;
  addIndex: boolean;
  stripUseClient: boolean;
  aliasPrefix?: string;
  aliasTarget?: string;
};

const DEFAULT_CFG: ProjectConfig = {
  baseDir: "src/hooks",
  addIndex: true,
  stripUseClient: false,
};

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const hint =
      res.status === 404
        ? "Not found (check baseUrl/path/branch or repo privacy)."
        : res.status === 403 || res.status === 401
        ? "Forbidden/Unauthorized (is the registry repo private?)."
        : "";
    throw new Error(`Fetch ${res.status}: ${url}${hint ? " — " + hint : ""}`);
  }
  return res.json() as Promise<T>;
}

async function getText(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch ${res.status}: ${url}`);
  return res.text();
}

async function ensureDir(d: string) {
  await fs.promises.mkdir(d, { recursive: true });
}

function cwd(...p: string[]) {
  return path.resolve(process.cwd(), ...p);
}

function findConfig(startDir = process.cwd()): string | null {
  let dir = path.resolve(startDir);
  while (true) {
    const p = path.join(dir, CONFIG_FILE);
    if (fs.existsSync(p)) return p;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readConfig(): ProjectConfig | null {
  const p = findConfig();
  if (!p) return null;
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    const cfg: ProjectConfig = {
      baseDir:
        typeof data.baseDir === "string" ? data.baseDir : DEFAULT_CFG.baseDir,
      addIndex:
        typeof data.addIndex === "boolean"
          ? data.addIndex
          : DEFAULT_CFG.addIndex,
      stripUseClient:
        typeof data.stripUseClient === "boolean"
          ? data.stripUseClient
          : DEFAULT_CFG.stripUseClient,
      aliasPrefix:
        typeof data.aliasPrefix === "string" ? data.aliasPrefix : undefined,
      aliasTarget:
        typeof data.aliasTarget === "string" ? data.aliasTarget : undefined,
    };
    return cfg;
  } catch {
    return null;
  }
}

async function writeConfig(cfg: ProjectConfig) {
  const p = cwd(CONFIG_FILE);
  await fs.promises.writeFile(p, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  console.log(`✔ Saved ${CONFIG_FILE}`);
  await ensureDir(cwd(cfg.baseDir));
}

async function backupFile(filePath: string) {
  if (!fs.existsSync(filePath)) return null;
  const bak = `${filePath}.bak`;
  await fs.promises.copyFile(filePath, bak);
  return bak;
}

function remapToBaseDir(originalTo: string, baseDir: string) {
  const norm = originalTo.replace(/\\/g, "/");
  const replaced = norm.replace(
    /^(?:src\/)?hooks/,
    baseDir.replace(/\\/g, "/")
  );
  return replaced;
}

async function cmdSearch(query: string) {
  const q = query.toLowerCase();
  const registry = await getJSON<any>(REGISTRY_URL);

  const results: Array<{
    id: string;
    score: number;
    desc?: string;
    tags?: string[];
  }> = [];

  const hooks: any[] = registry.hooks ?? [];
  const limit = 8; // параллельных запросов
  let i = 0;
  async function next() {
    const h = hooks[i++];
    if (!h) return;
    try {
      const meta = await getJSON<any>(
        `${registry.baseUrl}/${h.path}/meta.json`
      );
      const hay = [
        h.id,
        meta.name ?? "",
        meta.description ?? "",
        ...(meta.tags ?? []),
      ]
        .join(" ")
        .toLowerCase();
      const words = q.split(/\s+/).filter(Boolean);
      const score = hay.includes(q)
        ? 2
        : words.some((w) => hay.includes(w))
        ? 1
        : 0;
      if (score > 0) {
        results.push({
          id: h.id,
          score,
          desc: meta.description,
          tags: meta.tags,
        });
      }
    } catch {
      /* skip broken meta */
    }
    await next();
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, hooks.length) }, next)
  );

  results.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  if (results.length === 0) {
    console.log("No matches.");
    return;
  }
  for (const r of results) {
    const tags = r.tags?.length ? ` [${r.tags.join(", ")}]` : "";
    console.log("-", r.id, r.desc ? `— ${r.desc}${tags}` : tags);
  }
}

function parseLocalHookVersion(filePath: string): {
  id?: string;
  version?: string;
} {
  if (!fs.existsSync(filePath)) return {};
  const first = fs.readFileSync(filePath, "utf8").slice(0, 2048);
  const m = first.match(/hook:([a-z0-9-]+)@([0-9]+\.[0-9]+\.[0-9]+)/i);
  return m ? { id: m[1], version: m[2] } : {};
}

async function listLocalHooks(
  baseDir: string
): Promise<Array<{ id: string; file: string }>> {
  const indexTs = cwd(baseDir, "index.ts");
  const indexJs = cwd(baseDir, "index.js");
  if (fs.existsSync(indexTs) || fs.existsSync(indexJs)) {
    const indexPath = fs.existsSync(indexTs) ? indexTs : indexJs;
    const content = await fs.promises.readFile(indexPath, "utf8");
    const ids = [
      ...content.matchAll(/export\s+\*\s+from\s+['"]\.\/(.+)['"];?/g),
    ].map((m) => m[1]);
    return ids.map((id) => {
      const ts = cwd(baseDir, `${id}.ts`);
      const js = cwd(baseDir, `${id}.js`);
      return { id, file: fs.existsSync(ts) ? ts : js };
    });
  } else {
    const baseAbs = cwd(baseDir);
    if (!fs.existsSync(baseAbs)) return [];
    const files = (await walk(baseAbs)).filter((p) =>
      /[/\\]use-[^/\\]+\.(t|j)s$/.test(p)
    );
    return files.map((f) => ({ id: fileBaseName(f), file: f }));
  }
}

function cmpSemver(a: string, b: string) {
  const pa = a.split(".").map((n) => +n),
    pb = b.split(".").map((n) => +n);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

async function cmdOutdated() {
  const cfg = readConfig();
  const baseDir = cfg?.baseDir ?? "src/hooks";
  const registry = await getJSON<any>(REGISTRY_URL);
  const locals = await listLocalHooks(baseDir);

  if (locals.length === 0) {
    console.log("No installed hooks found.");
    return;
  }

  let any = false;
  await Promise.all(
    locals.map(async (l) => {
      const entry = registry.hooks.find((h: any) => h.id === l.id);
      if (!entry) return;
      try {
        const meta = await getJSON<any>(
          `${registry.baseUrl}/${entry.path}/meta.json`
        );
        const localVer = parseLocalHookVersion(l.file).version ?? "0.0.0";
        const remoteVer = meta.version ?? "0.0.0";
        if (cmpSemver(remoteVer, localVer) > 0) {
          any = true;
          console.log(`⚠ ${l.id}  ${localVer}  →  ${remoteVer}`);
        }
      } catch {}
    })
  );
  if (!any) console.log("All hooks are up to date.");
}

function fileBaseName(destPath: string) {
  return path.parse(destPath).name;
}

function removeUseClient(src: string) {
  return src.replace(/^\s*['"]use client['"];\s*\r?\n/, "");
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function toPosixPath(p: string) {
  return p.replace(/\\/g, "/");
}

function rewriteAliasImports(
  code: string,
  aliasPrefix: string | undefined,
  aliasTarget: string | undefined,
  destAbsFile: string,
  projectRootAbs: string
) {
  if (!aliasPrefix || !aliasTarget) return code;
  const prefix = aliasPrefix.endsWith("/") ? aliasPrefix : aliasPrefix + "/";
  const targetAbs = path.resolve(projectRootAbs, aliasTarget);

  const re = new RegExp(
    [
      `(from\\s+['"])${escapeRegex(prefix)}([^'"]+)(['"])`, // import x from '@/...'
      `(import\\s*\\(\\s*['"])${escapeRegex(prefix)}([^'"]+)(['"]\\s*\\))`, // import('...') dynamic
      `(export\\s*\\*\\s*from\\s*['"])${escapeRegex(prefix)}([^'"]+)(['"])`, // export * from '...'
      `(require\\(\\s*['"])${escapeRegex(prefix)}([^'"]+)(['"]\\s*\\))`, // require('...')
    ].join("|"),
    "g"
  );

  return code.replace(re, (...args: any[]) => {
    // args: match, then 12 capture groups, then offset, then input
    const groups = args.slice(1, 13);
    let left = "",
      subpath = "",
      right = "";
    for (let i = 0; i < groups.length; i += 3) {
      if (groups[i]) {
        left = groups[i];
        subpath = groups[i + 1];
        right = groups[i + 2];
        break;
      }
    }
    if (!subpath) return args[0];

    const abs = path.resolve(targetAbs, subpath);
    const rel = toPosixPath(path.relative(path.dirname(destAbsFile), abs));
    const normalized = rel.startsWith(".") ? rel : "./" + rel;
    return `${left}${normalized}${right}`;
  });
}

async function installHook(
  hookId: string,
  baseDir: string,
  addIndex: boolean,
  options?: {
    dry?: boolean;
    force?: boolean;
    stripUseClient?: boolean;
  }
) {
  const registry = await getJSON<any>(REGISTRY_URL);
  const baseUrl = registry.baseUrl;
  const entry = registry.hooks.find((h: any) => h.id === hookId);
  if (!entry) throw new Error(`Unknown hook: ${hookId}`);

  const meta = await getJSON<any>(`${baseUrl}/${entry.path}/meta.json`);
  console.log(`Installing ${meta.name} (${meta.id})`);

  const cfg = readConfig() ?? DEFAULT_CFG;
  const stripClient = options?.stripUseClient ?? cfg.stripUseClient;

  let lastExportName: string | null = null;

  for (const f of meta.files) {
    const destRemapped = remapToBaseDir(f.to, baseDir);
    const dest = cwd(destRemapped);
    const src = `${baseUrl}/${entry.path}/${f.from}`;

    if (options?.dry) {
      console.log("[dry] would write", path.relative(process.cwd(), dest));
      lastExportName = fileBaseName(dest);
      continue;
    }

    let content = await getText(src);

    if (stripClient) content = removeUseClient(content);

    content = rewriteAliasImports(
      content,
      cfg.aliasPrefix,
      cfg.aliasTarget,
      dest,
      process.cwd()
    );

    await ensureDir(path.dirname(dest));
    const header = `/* Installed via wkkkis-hooks | hook:${meta.id}@${
      meta.version ?? "0.0.0"
    } | registry:${registry.version ?? "0"} */\n`;

    if (fs.existsSync(dest) && !options?.force) {
      const bak = await backupFile(dest);
      if (bak) console.log("↺ backup", path.relative(process.cwd(), bak));
    }
    await fs.promises.writeFile(dest, header + content, "utf8");
    console.log("✔", path.relative(process.cwd(), dest));

    lastExportName = fileBaseName(dest);
  }

  if (addIndex && lastExportName) {
    const indexFile = "index.ts";
    const indexPath = cwd(baseDir, indexFile);
    const exportLine = `export * from "./${lastExportName}";\n`;

    if (options?.dry) {
      console.log(
        "[dry] would update",
        path.relative(process.cwd(), indexPath)
      );
    } else {
      if (fs.existsSync(indexPath)) {
        const curr = await fs.promises.readFile(indexPath, "utf8");
        if (!curr.includes(exportLine)) {
          await fs.promises.appendFile(indexPath, exportLine, "utf8");
          console.log("↻ updated", path.relative(process.cwd(), indexPath));
        }
      } else {
        await ensureDir(path.dirname(indexPath));
        await fs.promises.writeFile(indexPath, exportLine, "utf8");
        console.log("✔ created", path.relative(process.cwd(), indexPath));
      }
    }
  }

  if (meta.peerDependencies) {
    console.log("Peer deps:", JSON.stringify(meta.peerDependencies));
  }
}

async function cmdList() {
  const registry = await getJSON<any>(REGISTRY_URL);
  registry.hooks.forEach((h: any) => {
    const desc = h.description ? ` — ${h.description}` : "";
    console.log("-", h.id + desc);
  });
}

async function cmdInfo(hookId: string) {
  const registry = await getJSON<any>(REGISTRY_URL);
  const baseUrl = registry.baseUrl;
  const entry = registry.hooks.find((h: any) => h.id === hookId);
  if (!entry) throw new Error(`Unknown hook: ${hookId}`);

  const meta = await getJSON<any>(`${baseUrl}/${entry.path}/meta.json`);
  console.log(`\n${meta.name} (${meta.id})`);
  if (meta.description) console.log(meta.description);
  if (meta.peerDependencies)
    console.log("peerDeps:", JSON.stringify(meta.peerDependencies));
  console.log("files:");
  for (const f of meta.files) {
    console.log("  -", f.from, "→", f.to);
  }
  console.log("");
}

async function cmdAdd(
  hookId?: string,
  opts?: { baseDir?: string; addIndex?: boolean }
) {
  const cfg = readConfig();
  const registry = await getJSON<any>(REGISTRY_URL);

  let id = hookId;
  if (!id) {
    const ans = await prompts({
      type: "autocomplete",
      name: "hook",
      message: "Choose a hook to add",
      choices: registry.hooks.map((h: any) => ({ title: h.id, value: h.id })),
    });
    id = ans.hook;
    if (!id) return;
  }
  const baseDir = opts?.baseDir ?? cfg?.baseDir ?? "src/hooks";
  const addIndex =
    typeof opts?.addIndex === "boolean" ? opts.addIndex : cfg?.addIndex ?? true;

  await installHook(id, baseDir, addIndex, {
    stripUseClient: readConfig()?.stripUseClient ?? false,
  });
}

async function cmdInit() {
  const isTty =
    process.stdout.isTTY === true &&
    !process.argv.includes("--yes") &&
    !process.argv.includes("-y");

  let answers: any = {
    addIndex: true,
    baseDir: "src/hooks",
    stripUseClient: false,
    aliasPrefix: "",
    aliasTarget: "src",
    useAlias: false,
  };

  if (isTty) {
    try {
      const a = await prompts([
        {
          type: "toggle",
          name: "addIndex",
          message: "Maintain index file with re-exports?",
          initial: true,
          active: "yes",
          inactive: "no",
        },
        {
          type: "text",
          name: "baseDir",
          message: "Where should hooks be installed?",
          initial: "src/hooks",
          validate: (v: string) => (v.trim() ? true : "Path is required"),
        },
        {
          type: "select",
          name: "framework",
          message: "Target framework?",
          choices: [
            { title: "Next.js", value: "next" },
            { title: "React (Vite/CRA/etc.)", value: "react" },
            { title: "Other", value: "other" },
          ],
          initial: 0,
        },
        {
          type: (prev, values) =>
            values.framework === "next" ? null : "toggle",
          name: "stripUseClient",
          message: 'Strip "use client" directive from installed hooks?',
          initial: false,
          active: "strip",
          inactive: "keep",
        },
        {
          type: "toggle",
          name: "useAlias",
          message: "Rewrite path aliases in imports? (e.g. @/ to relative)",
          initial: false,
          active: "on",
          inactive: "off",
        },
        {
          type: (prev, values) => (values.useAlias ? "text" : null),
          name: "aliasPrefix",
          message: "Alias prefix",
          initial: "@/",
        },
        {
          type: (prev, values) => (values.useAlias ? "text" : null),
          name: "aliasTarget",
          message: "Alias points to folder",
          initial: "src",
        },
      ]).catch(() => ({}));
      answers = { ...answers, ...a };
    } catch {}

    if (!answers.baseDir || typeof answers.addIndex !== "boolean") {
      console.log("Canceled.");
      return;
    }
  } else {
    console.log("(non-TTY) Using defaults for init.");
  }

  const cfg: ProjectConfig = {
    baseDir: answers.baseDir,
    addIndex: !!answers.addIndex,
    stripUseClient: !!answers.stripUseClient,
    aliasPrefix: answers.useAlias ? answers.aliasPrefix || "@/" : undefined,
    aliasTarget: answers.useAlias ? answers.aliasTarget || "src" : undefined,
  };

  await writeConfig(cfg);

  if (isTty) {
    try {
      const registry = await getJSON<any>(REGISTRY_URL);
      const pick = await prompts({
        type: "autocomplete",
        name: "hook",
        message: "Install a sample hook now?",
        choices: [
          { title: "Skip", value: "__SKIP__" },
          ...registry.hooks.map((h: any) => ({ title: h.id, value: h.id })),
        ],
      }).catch(() => ({ hook: "__SKIP__" }));

      const chosen = pick?.hook ?? "__SKIP__";
      if (chosen !== "__SKIP__") {
        await installHook(chosen, cfg.baseDir, cfg.addIndex, {
          stripUseClient: cfg.stripUseClient,
        });
      } else {
        console.log("You can add hooks later with: wkkkis-hooks add <hook>");
      }
    } catch (e: any) {
      console.log("Skip sample install:", e?.message ?? String(e));
    }
  }
}

async function cmdUpdate(
  hookId: string,
  opts?: {
    baseDir?: string;
    addIndex?: boolean;
    dry?: boolean;
    force?: boolean;
  }
) {
  const cfg = readConfig();
  const baseDir = opts?.baseDir ?? cfg?.baseDir ?? "src/hooks";
  const addIndex =
    typeof opts?.addIndex === "boolean" ? opts.addIndex : cfg?.addIndex ?? true;

  console.log("(update) pulling latest from registry…");

  await installHook(hookId, baseDir, addIndex, {
    dry: opts?.dry,
    force: opts?.force,
    stripUseClient: cfg?.stripUseClient ?? false,
  });
}

async function cmdRemove(hookId: string, opts?: { baseDir?: string }) {
  const cfg = readConfig();
  const baseDir = opts?.baseDir ?? cfg?.baseDir ?? "src/hooks";

  const registry = await getJSON<any>(REGISTRY_URL);
  const baseUrl = registry.baseUrl;
  const entry = registry.hooks.find((h: any) => h.id === hookId);
  if (!entry) throw new Error(`Unknown hook: ${hookId}`);
  const meta = await getJSON<any>(`${baseUrl}/${entry.path}/meta.json`);

  for (const f of meta.files) {
    const destRemapped = remapToBaseDir(f.to, baseDir);
    const dest = cwd(destRemapped);
    const base = fileBaseName(dest);

    if (fs.existsSync(dest)) {
      await fs.promises.unlink(dest);
      console.log("✖", path.relative(process.cwd(), dest));
    }

    for (const idxName of ["index.ts", "index.js"]) {
      const indexPath = cwd(baseDir, idxName);
      if (!fs.existsSync(indexPath)) continue;
      const curr = await fs.promises.readFile(indexPath, "utf8");
      const reg = new RegExp(
        String.raw`^export \* from "\./${base}";\r?\n?`,
        "m"
      );
      if (reg.test(curr)) {
        const next = curr.replace(reg, "");
        await fs.promises.writeFile(indexPath, next, "utf8");
        console.log("↻ updated", path.relative(process.cwd(), indexPath));
      }
    }
  }
}

async function walk(dir: string, acc: string[] = []): Promise<string[]> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

async function cmdReadme() {
  const cfg = readConfig();
  const baseDir = cfg?.baseDir ?? "src/hooks";
  const registry = await getJSON<any>(REGISTRY_URL);

  const locals = await listLocalHooks(baseDir);
  if (locals.length === 0) {
    console.log("No hooks found to document.");
    return;
  }

  let md = `# Installed Hooks\n\n`;
  for (const { id } of locals) {
    const entry = registry.hooks.find((h: any) => h.id === id);
    if (!entry) continue;
    const meta = await getJSON<any>(
      `${registry.baseUrl}/${entry.path}/meta.json`
    );
    md += `## ${meta.name}\n`;
    if (meta.description) md += `${meta.description}\n\n`;
    if (meta.tags?.length) md += `tags: ${meta.tags.join(", ")}\n\n`;
    md += `\`import { ${meta.name} } from "${baseDir}"\`\n\n`;
  }

  const dest = cwd("HOOKS.md");
  await fs.promises.writeFile(dest, md, "utf8");
  console.log("✔ HOOKS.md generated");
}

async function cmdPreset(name: string) {
  const cfg = readConfig();
  const baseDir = cfg?.baseDir ?? "src/hooks";
  const addIndex = cfg?.addIndex ?? true;

  if (name === "essentials") {
    const hooks = [
      "use-boolean",
      "use-debounce",
      "use-disclosure",
      "use-event-listener",
      "use-clipboard",
    ];
    for (const h of hooks) {
      await installHook(h, baseDir, addIndex, {
        force: true,
        stripUseClient: readConfig()?.stripUseClient ?? false,
      });
    }
    console.log("✔ essentials preset installed");
  } else {
    console.log("Unknown preset:", name);
  }
}

async function cmdDoctor() {
  const cfg = readConfig();
  const baseDir = cfg?.baseDir ?? "src/hooks";
  const registry = await getJSON<any>(REGISTRY_URL);
  const locals = await listLocalHooks(baseDir);

  if (locals.length === 0) {
    console.log("No installed hooks found.");
    return;
  }

  let ok = true;
  for (const l of locals) {
    if (!fs.existsSync(l.file)) {
      ok = false;
      console.log(`✖ missing file: ${path.relative(process.cwd(), l.file)}`);
      continue;
    }
    const parsed = parseLocalHookVersion(l.file);
    if (!parsed.id) {
      ok = false;
      console.log(
        `✖ no header: ${path.relative(
          process.cwd(),
          l.file
        )} (reinstall this hook)`
      );
      continue;
    }
    if (parsed.id !== l.id) {
      ok = false;
      console.log(`✖ id mismatch: file=${l.id} header=${parsed.id}`);
    } else {
      const exists = registry.hooks.some((h: any) => h.id === l.id);
      if (!exists) {
        ok = false;
        console.log(`✖ not in registry: ${l.id}`);
      } else {
        console.log(`✔ ${l.id} (${parsed.version})`);
      }
    }
  }

  if (ok) console.log("Doctor: all good.");
}

async function cmdMigrate(newBaseDir: string) {
  if (!newBaseDir || !newBaseDir.trim())
    throw new Error("Usage: wkkkis-hooks migrate --path=<newDir>");
  const cfg = readConfig() ?? DEFAULT_CFG;
  const oldBase = cfg.baseDir;
  if (path.resolve(oldBase) === path.resolve(newBaseDir)) {
    console.log("Already using", newBaseDir);
    return;
  }

  await ensureDir(cwd(newBaseDir));
  const files = fs.existsSync(cwd(oldBase))
    ? (await walk(cwd(oldBase))).filter(
        (p) => p.endsWith(".ts") || p.endsWith(".js")
      )
    : [];
  for (const full of files) {
    const basename = path.basename(full);
    const target = cwd(newBaseDir, basename);
    await fs.promises.copyFile(full, target);
    console.log("→", path.relative(process.cwd(), target));
  }

  const nextCfg: ProjectConfig = {
    baseDir: newBaseDir,
    addIndex: cfg.addIndex,
    stripUseClient: cfg.stripUseClient,
    aliasPrefix: cfg.aliasPrefix,
    aliasTarget: cfg.aliasTarget,
  };
  await writeConfig(nextCfg);
  console.log("✔ migrated config to", newBaseDir);
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  try {
    if (cmd === "list") return cmdList();

    if (cmd === "info") {
      const id = args[1];
      if (!id) throw new Error("Usage: wkkkis-hooks info <hook>");
      return cmdInfo(id);
    }

    if (cmd === "init") return cmdInit();

    if (cmd === "add") {
      const hookId = args[1];
      const baseDirFlag = args.find((a) => a.startsWith("--path="));
      const noIndex = args.includes("--no-index");
      const baseDir = baseDirFlag ? baseDirFlag.split("=")[1] : undefined;
      return cmdAdd(hookId, { baseDir, addIndex: noIndex ? false : undefined });
    }

    if (cmd === "update") {
      const hookId = args[1];
      if (!hookId) throw new Error("Usage: wkkkis-hooks update <hook>");
      const baseDirFlag = args.find((a) => a.startsWith("--path="));
      const dry = args.includes("--dry");
      const force = args.includes("--force");
      const baseDir = baseDirFlag ? baseDirFlag.split("=")[1] : undefined;
      return cmdUpdate(hookId, { baseDir, dry, force });
    }

    if (cmd === "remove") {
      const hookId = args[1];
      if (!hookId) throw new Error("Usage: wkkkis-hooks remove <hook>");
      const baseDirFlag = args.find((a) => a.startsWith("--path="));
      const baseDir = baseDirFlag ? baseDirFlag.split("=")[1] : undefined;
      return cmdRemove(hookId, { baseDir });
    }

    if (cmd === "readme") return cmdReadme();

    if (cmd === "preset") {
      const name = args[1];
      if (!name) throw new Error("Usage: wkkkis-hooks preset <name>");
      return cmdPreset(name);
    }

    if (cmd === "search") {
      const q = args.slice(1).join(" ").trim();
      if (!q) throw new Error("Usage: wkkkis-hooks search <query>");
      return cmdSearch(q);
    }

    if (cmd === "outdated") return cmdOutdated();

    if (cmd === "doctor") return cmdDoctor();

    if (cmd === "migrate") {
      const baseDirFlag = args.find((a) => a.startsWith("--path="));
      if (!baseDirFlag)
        throw new Error("Usage: wkkkis-hooks migrate --path=<newDir>");
      const newDir = baseDirFlag.split("=")[1];
      return cmdMigrate(newDir);
    }

    console.log(
      `wkkkis-hooks <command>

Commands:
  init                          Initialize project config (path + index)
  list                          Show available hooks
  info <hook>                   Show hook meta and files
  add <hook> [--path=..] [--no-index]
  update <hook> [--path=..] [--force] [--dry]
  remove <hook> [--path=..]
  readme                        Generate HOOKS.md (works without index.ts)
  preset <name>                 Install a set (e.g., "essentials")
  search <query>                Search hooks by id/name/description/tags
  outdated                      Show hooks that have newer versions in registry
  doctor                        Validate installed hooks/files against registry
  migrate --path=...            Copy all hooks to a new baseDir and update config

Flags:
  --path=src/shared/hooks       Override install path
  --no-index                    Do not touch index.ts on add
  --force                       Overwrite files without .bak on update
  --dry                         Show what would change (update only)
`
    );
  } catch (e: any) {
    console.error("Error:", e.message);
    process.exit(1);
  }
}

main();
