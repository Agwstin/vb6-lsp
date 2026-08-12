// Deep telemetry analysis: error messages, miss patterns, input shapes.
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(process.cwd(), 'telemetry');
const files = fs.readdirSync(dir).filter(f => f.startsWith('mcp-usage.jsonl'));
const events = [];
for (const f of files) {
  for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/)) {
    if (!line) continue;
    try { events.push(JSON.parse(line)); } catch {}
  }
}
console.log(`total events: ${events.length}\n`);

// 1. Error message aggregation
const errCounts = new Map();
for (const e of events) {
  if (!e.error) continue;
  const msg = String(e.error).slice(0, 160).replace(/\s+/g, ' ');
  const key = `${e.tool_name}\t${e.error_kind || 'unknown'}\t${msg}`;
  errCounts.set(key, (errCounts.get(key) || 0) + 1);
}
console.log('=== ERRORS (tool / kind / message / count) ===');
for (const [k, c] of [...errCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50)) {
  console.log(`${c}\t${k}`);
}

// 2. Miss patterns per tool: distribution of input shapes on zero-result calls
console.log('\n=== ZERO-RESULT input shapes ===');
const missByTool = new Map();
for (const e of events) {
  if (e.result_count !== 0) continue;
  const g = missByTool.get(e.tool_name) || [];
  g.push(e);
  missByTool.set(e.tool_name, g);
}
for (const [tool, group] of [...missByTool.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n${tool}: ${group.length} misses`);
  const shapeCounts = new Map();
  for (const e of group) {
    const is = e.input_summary || {};
    const shape = JSON.stringify(is);
    shapeCounts.set(shape, (shapeCounts.get(shape) || 0) + 1);
  }
  for (const [s, c] of [...shapeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`  ${c}x ${s.slice(0, 200)}`);
  }
}

// 3. Captured raw inputs if any (schema may include query/name fields directly)
console.log('\n=== RAW INPUT FIELDS PRESENT? ===');
const keys = new Set();
for (const e of events.slice(-500)) {
  for (const k of Object.keys(e.input_summary || {})) keys.add(k);
  for (const k of Object.keys(e)) keys.add('top:' + k);
}
console.log([...keys].sort().join(', '));
