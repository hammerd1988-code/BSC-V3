import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { discoverPlugins, getProjectPluginsDir, getGlobalPluginsDir } from './loader.js';
import type { LoadedPlugin, PluginManifest } from './types.js';

// ── Cyberpunk visual constants ────────────────────────────────────────────────

const NEON = chalk.magenta;
const CYBER = chalk.cyan;
const DIM = chalk.dim;
const GLOW = chalk.bold.magenta;
const SUCCESS = chalk.green;
const WARN = chalk.yellow;
const ERR = chalk.red;

const PLUGIN_BANNER = `
${NEON('╔══════════════════════════════════════════════╗')}
${NEON('║')}  ${GLOW('  CASPER PLUGIN SYSTEM')}  ${DIM('// neural extensions')}  ${NEON('║')}
${NEON('╚══════════════════════════════════════════════╝')}`;

const BOX_TOP    = NEON('  ┌──────────────────────────────────────────┐');
const BOX_BOT    = NEON('  └──────────────────────────────────────────┘');
const BOX_MID    = NEON('  ├──────────────────────────────────────────┤');
const BULLET     = CYBER('  ▸ ');
const DOT        = DIM('    · ');

// ── casper plugin list ────────────────────────────────────────────────────────

export function pluginList(): void {
  const { plugins, errors } = discoverPlugins();

  console.log(PLUGIN_BANNER);

  if (errors.length > 0) {
    console.log(WARN('\n  ⚠  Some plugins failed to load:\n'));
    for (const err of errors) {
      console.log(`    ${ERR('✗')} ${chalk.white(err.plugin)}.${DIM(err.field)}: ${err.message}`);
    }
    console.log('');
  }

  if (plugins.length === 0) {
    console.log(DIM('\n  No plugins installed yet.\n'));
    console.log(DIM('  Get started:'));
    console.log(CYBER('    casper plugin init my-tool    ') + DIM('Create a new plugin'));
    console.log(CYBER('    casper plugin init my-tool -g ') + DIM('Create a global plugin'));
    console.log('');
    console.log(DIM('  Plugins extend Casper with custom tools the AI can use.'));
    console.log(DIM('  Project plugins live in .casper/plugins/'));
    console.log(DIM('  Global plugins live in ~/.config/casper-cli/plugins/\n'));
    return;
  }

  console.log('');

  const projectPlugins = plugins.filter(p => p.scope === 'project');
  const globalPlugins = plugins.filter(p => p.scope === 'global');

  if (projectPlugins.length > 0) {
    console.log(GLOW('  PROJECT PLUGINS') + DIM(' (.casper/plugins/)'));
    console.log(BOX_TOP);
    for (const p of projectPlugins) {
      printPluginRow(p);
    }
    console.log(BOX_BOT);
  }

  if (globalPlugins.length > 0) {
    if (projectPlugins.length > 0) console.log('');
    console.log(GLOW('  GLOBAL PLUGINS') + DIM(' (~/.config/casper-cli/plugins/)'));
    console.log(BOX_TOP);
    for (const p of globalPlugins) {
      printPluginRow(p);
    }
    console.log(BOX_BOT);
  }

  console.log(DIM(`\n  ${plugins.length} plugin${plugins.length !== 1 ? 's' : ''} loaded. The AI can use these as tools automatically.\n`));
}

function printPluginRow(p: LoadedPlugin): void {
  const m = p.manifest;
  const params = m.parameters ? Object.keys(m.parameters) : [];
  const paramStr = params.length > 0
    ? DIM(`(${params.join(', ')})`)
    : DIM('(no params)');
  const dangerBadge = m.dangerous ? ERR(' [DANGEROUS]') : '';
  const tagStr = m.tags && m.tags.length > 0
    ? DIM(` #${m.tags.join(' #')}`)
    : '';

  console.log(`${BULLET}${CYBER(m.name)} ${DIM(`v${m.version}`)}${dangerBadge}`);
  console.log(`${DOT}${chalk.white(m.description)}`);
  console.log(`${DOT}${DIM('entry:')} ${m.entry} ${DIM('·')} ${DIM('runtime:')} ${m.runtime} ${DIM('·')} ${paramStr}${tagStr}`);
  if (m.author) {
    console.log(`${DOT}${DIM('by')} ${chalk.white(m.author)}`);
  }
}

// ── casper plugin info ────────────────────────────────────────────────────────

export function pluginInfo(name: string): void {
  const { plugins } = discoverPlugins();
  const plugin = plugins.find(p => p.manifest.name === name);

  if (!plugin) {
    console.log(ERR(`\n  Plugin "${name}" not found.`));
    console.log(DIM(`  Run ${CYBER('casper plugin list')} to see available plugins.\n`));
    return;
  }

  const m = plugin.manifest;
  console.log(PLUGIN_BANNER);
  console.log('');
  console.log(BOX_TOP);
  console.log(`${BULLET}${GLOW(m.name)} ${DIM(`v${m.version}`)}`);
  console.log(BOX_MID);
  console.log(`${DOT}${chalk.white(m.description)}`);
  if (m.author) console.log(`${DOT}${DIM('Author:')} ${chalk.white(m.author)}`);
  console.log(`${DOT}${DIM('Scope:')}  ${plugin.scope === 'project' ? CYBER('project') : GLOW('global')}`);
  console.log(`${DOT}${DIM('Entry:')}  ${m.entry}`);
  console.log(`${DOT}${DIM('Runtime:')} ${m.runtime}`);
  console.log(`${DOT}${DIM('Timeout:')} ${m.timeout_ms ?? 60000}ms`);
  if (m.dangerous) console.log(`${DOT}${ERR('DANGEROUS')} — Casper will ask for confirmation`);
  if (m.tags && m.tags.length > 0) console.log(`${DOT}${DIM('Tags:')}   ${m.tags.map(t => CYBER(`#${t}`)).join(' ')}`);
  console.log(`${DOT}${DIM('Dir:')}    ${plugin.directory}`);

  if (m.parameters && Object.keys(m.parameters).length > 0) {
    console.log(BOX_MID);
    console.log(`${BULLET}${chalk.white('Parameters:')}`);
    for (const [pName, pDef] of Object.entries(m.parameters)) {
      const req = pDef.required !== false ? ERR('*') : '';
      const def = pDef.default !== undefined ? DIM(` [default: ${JSON.stringify(pDef.default)}]`) : '';
      const en = pDef.enum ? DIM(` {${pDef.enum.join('|')}}`) : '';
      console.log(`${DOT}${CYBER(pName)}${req} ${DIM(`(${pDef.type})`)} — ${pDef.description}${def}${en}`);
    }
  }

  console.log(BOX_BOT);
  console.log(DIM(`\n  The AI uses this as tool: ${CYBER(`plugin__${m.name}`)}\n`));
}

// ── casper plugin init ────────────────────────────────────────────────────────

export function pluginInit(name: string, opts: { global?: boolean; runtime?: string }): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    console.log(ERR(`\n  Invalid plugin name "${name}".`));
    console.log(DIM(`  Use lowercase letters, numbers, and hyphens (e.g. "my-tool").\n`));
    return;
  }

  const baseDir = opts.global ? getGlobalPluginsDir() : getProjectPluginsDir();
  const pluginDir = path.join(baseDir, name);

  if (fs.existsSync(pluginDir)) {
    console.log(WARN(`\n  Plugin "${name}" already exists at ${pluginDir}`));
    console.log(DIM(`  Remove it first with: ${CYBER(`casper plugin remove ${name}`)}\n`));
    return;
  }

  fs.mkdirSync(pluginDir, { recursive: true });

  const runtime = opts.runtime ?? 'node';
  const ext = runtime === 'python' ? 'py' : runtime === 'bash' ? 'sh' : 'js';
  const entryFile = `index.${ext}`;

  // Write manifest
  const manifest: PluginManifest = {
    name,
    description: `Custom plugin: ${name}`,
    version: '0.1.0',
    author: '',
    entry: entryFile,
    runtime: runtime as PluginManifest['runtime'],
    parameters: {
      input: {
        type: 'string',
        description: 'Input value for the plugin.',
        required: true,
      },
    },
    timeout_ms: 60000,
    dangerous: false,
    tags: ['custom'],
  };

  fs.writeFileSync(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf-8',
  );

  // Write entry script
  const entryContent = getScaffoldEntry(name, runtime);
  fs.writeFileSync(path.join(pluginDir, entryFile), entryContent, 'utf-8');

  // Write README
  fs.writeFileSync(path.join(pluginDir, 'README.md'), getScaffoldReadme(name, runtime), 'utf-8');

  const scope = opts.global ? 'global' : 'project';

  console.log(`
${NEON('╔══════════════════════════════════════════════╗')}
${NEON('║')}  ${GLOW('  PLUGIN CREATED')}  ${DIM(`// ${name}`)}${' '.repeat(Math.max(0, 18 - name.length))}${NEON('║')}
${NEON('╚══════════════════════════════════════════════╝')}

${BULLET}${chalk.white('Name:')}      ${CYBER(name)}
${BULLET}${chalk.white('Scope:')}     ${scope === 'project' ? CYBER('project') : GLOW('global')}
${BULLET}${chalk.white('Runtime:')}   ${runtime}
${BULLET}${chalk.white('Location:')}  ${DIM(pluginDir)}

${DIM('  Files created:')}
${DOT}plugin.json   ${DIM('— manifest (edit to add parameters)')}
${DOT}${entryFile}${' '.repeat(Math.max(0, 14 - entryFile.length))}${DIM('— entry script (your code goes here)')}
${DOT}README.md     ${DIM('— documentation')}

${DIM('  Next steps:')}
${DOT}Edit ${CYBER(entryFile)} to implement your tool logic
${DOT}Edit ${CYBER('plugin.json')} to define parameters
${DOT}Run ${CYBER(`casper plugin info ${name}`)} to verify
${DOT}The AI will pick it up automatically on next chat
`);
}

function getScaffoldEntry(name: string, runtime: string): string {
  if (runtime === 'python') {
    return `#!/usr/bin/env python3
"""
Casper Plugin: ${name}
Edit this file to implement your custom tool logic.

Input:  JSON object from stdin (your parameters from plugin.json)
Output: JSON object to stdout with { ok: bool, data: any, error?: str }
"""
import json
import sys

def main():
    # Read arguments from stdin
    args = json.loads(sys.stdin.read())
    input_value = args.get("input", "")

    # --- Your logic here ---
    result = f"Plugin '${name}' received: {input_value}"

    # Return result as JSON
    print(json.dumps({
        "ok": True,
        "data": { "result": result }
    }))

if __name__ == "__main__":
    main()
`;
  }

  if (runtime === 'bash') {
    return `#!/usr/bin/env bash
# Casper Plugin: ${name}
# Edit this file to implement your custom tool logic.
#
# Input:  JSON object from stdin (your parameters from plugin.json)
# Output: JSON object to stdout with { ok: bool, data: any, error?: str }

# Read JSON args from stdin
ARGS=$(cat)
INPUT=$(echo "$ARGS" | grep -o '"input":"[^"]*"' | cut -d'"' -f4)

# --- Your logic here ---
RESULT="Plugin '${name}' received: $INPUT"

# Return result as JSON
echo "{\\"ok\\": true, \\"data\\": {\\"result\\": \\"$RESULT\\"}}"
`;
  }

  // Default: Node.js
  return `#!/usr/bin/env node
/**
 * Casper Plugin: ${name}
 * Edit this file to implement your custom tool logic.
 *
 * Input:  JSON object from stdin (your parameters from plugin.json)
 * Output: JSON object to stdout with { ok: boolean, data: any, error?: string }
 */

async function main() {
  // Read arguments from stdin
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const args = JSON.parse(Buffer.concat(chunks).toString());
  const input = args.input || '';

  // --- Your logic here ---
  const result = \`Plugin '${name}' received: \${input}\`;

  // Return result as JSON
  console.log(JSON.stringify({
    ok: true,
    data: { result },
  }));
}

main().catch((err) => {
  console.log(JSON.stringify({
    ok: false,
    data: null,
    error: err.message,
  }));
  process.exit(1);
});
`;
}

function getScaffoldReadme(name: string, runtime: string): string {
  return `# ${name}

A custom Casper CLI plugin.

## How it works

When Casper's AI needs to use this tool, it will:
1. Read your \`plugin.json\` to understand what this plugin does
2. Call the entry script with parameters as JSON on stdin
3. Read the JSON result from stdout

## Files

- \`plugin.json\` — Manifest defining the tool name, description, and parameters
- \`index.${runtime === 'python' ? 'py' : runtime === 'bash' ? 'sh' : 'js'}\` — Entry script that runs when the tool is called
- \`README.md\` — This file

## Parameters

Edit \`plugin.json\` to add/modify parameters. Each parameter needs:
- \`type\`: "string", "number", "boolean", "object", or "array"
- \`description\`: What the AI should know about this parameter
- \`required\`: Whether this parameter is mandatory (default: true)

## Output Format

Your entry script must output JSON to stdout:
\`\`\`json
{
  "ok": true,
  "data": { "your": "result data" },
  "error": null
}
\`\`\`

## Testing

Run your plugin manually:
\`\`\`bash
echo '{"input": "test"}' | ${runtime === 'python' ? 'python3' : runtime === 'bash' ? 'bash' : 'node'} index.${runtime === 'python' ? 'py' : runtime === 'bash' ? 'sh' : 'js'}
\`\`\`

Or verify it loads correctly:
\`\`\`bash
casper plugin info ${name}
\`\`\`
`;
}

// ── casper plugin remove ──────────────────────────────────────────────────────

export function pluginRemove(name: string, opts: { global?: boolean }): void {
  const projectDir = path.join(getProjectPluginsDir(), name);
  const globalDir = path.join(getGlobalPluginsDir(), name);

  let targetDir: string | null = null;
  let scope: string = 'project';

  if (opts.global) {
    if (fs.existsSync(globalDir)) {
      targetDir = globalDir;
      scope = 'global';
    }
  } else {
    if (fs.existsSync(projectDir)) {
      targetDir = projectDir;
      scope = 'project';
    } else if (fs.existsSync(globalDir)) {
      targetDir = globalDir;
      scope = 'global';
    }
  }

  if (!targetDir) {
    console.log(ERR(`\n  Plugin "${name}" not found.`));
    console.log(DIM(`  Run ${CYBER('casper plugin list')} to see installed plugins.\n`));
    return;
  }

  fs.rmSync(targetDir, { recursive: true, force: true });

  console.log(`
${NEON('  ┌──────────────────────────────────────────┐')}
${NEON('  │')}  ${ERR('PLUGIN REMOVED')}  ${DIM(`// ${name}`)}${' '.repeat(Math.max(0, 20 - name.length))}${NEON('│')}
${NEON('  └──────────────────────────────────────────┘')}

${BULLET}${chalk.white(name)} ${DIM(`(${scope})`)} has been uninstalled.
${DIM('  Its files have been permanently deleted.')}
`);
}
