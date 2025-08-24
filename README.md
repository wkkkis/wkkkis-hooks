[![npm version](https://img.shields.io/npm/v/wkkkis-hooks.svg?style=flat&color=blue)](https://www.npmjs.com/package/wkkkis-hooks)
[![npm downloads](https://img.shields.io/npm/dm/wkkkis-hooks.svg?color=brightgreen)](https://www.npmjs.com/package/wkkkis-hooks)
[![Node.js Version](https://img.shields.io/badge/node-%3E=18-green)](https://nodejs.org)
[![License](https://img.shields.io/github/license/wkkkis/wkkkis-hooks)](LICENSE)

# wkkkis-hooks

A tiny CLI for installing ready-to-use **React/Next.js hooks** from a public registry into your project.  
Think of it as _npm install_ — but only for hooks.

---

## ✨ Features

- 🚀 Install hooks directly from the [wkkkis/hooks-registry](https://github.com/wkkkis/hooks-registry)
- 📂 Configurable install path (`src/hooks` by default)
- 🪝 Auto-update `index.ts` with exports
- 🔍 Search, list, update, remove hooks
- 🧹 Optional stripping of `"use client"`
- 🔗 Path alias rewriting (e.g. `@/` → relative paths)
- 🩺 Doctor check & README generator

---

## 📦 Installation

```bash
npm install -g wkkkis-hooks
```

Requires **Node.js 18+**.

---

## 🚀 Quick Start

```bash
# Initialize hooks.config.json in your project
wkkkis-hooks init

# Install a hook
wkkkis-hooks add use-debounce

# List available hooks
wkkkis-hooks list

# Update a hook to the latest version
wkkkis-hooks update use-debounce

# Remove a hook
wkkkis-hooks remove use-debounce
```

---

## ⚙️ Configuration

The CLI creates a `hooks.config.json` in your project root:

```json
{
  "baseDir": "src/hooks",
  "addIndex": true,
  "stripUseClient": false,
  "aliasPrefix": "@/ ",
  "aliasTarget": "src"
}
```

- **baseDir** — where hooks will be installed.
- **addIndex** — auto-maintain an `index.ts` with re-exports.
- **stripUseClient** — remove `"use client"` directive from installed hooks.
- **aliasPrefix / aliasTarget** — rewrite import paths from an alias (e.g. `@/components`) into relative paths when writing files.

---

## 📖 Commands

```
wkkkis-hooks <command>

init                          Initialize project config
list                          Show available hooks
info <hook>                   Show hook metadata and files
add <hook> [--path=..]        Install a hook
update <hook> [--force]       Update a hook to latest version
remove <hook>                 Remove a hook
readme                        Generate HOOKS.md with documentation
preset <name>                 Install a preset (e.g. "essentials")
search <query>                Search hooks by id/name/description/tags
outdated                      Show hooks that have newer versions
doctor                        Validate installed hooks
migrate --path=<newDir>       Move hooks to a new folder
```

---

## 📚 Example

```bash
wkkkis-hooks init --path=src/shared/hooks --alias-prefix=@/ --alias-target=src
wkkkis-hooks add use-boolean
wkkkis-hooks add use-clipboard
```

Now you can import:

```ts
import { useBoolean, useClipboard } from "@/hooks";
```

---

## 🤝 Contributing

Issues and PRs are welcome!  
Hooks themselves live in [wkkkis/hooks-registry](https://github.com/wkkkis/hooks-registry).  
This CLI just installs them into your project.

---

## 📜 License

MIT © 2025 wkkkis
