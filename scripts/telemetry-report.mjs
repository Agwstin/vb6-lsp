import fs from 'node:fs';
import path from 'node:path';

const telemetryDir = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(process.cwd(), 'telemetry');
const files = [
  path.join(telemetryDir, 'mcp-usage.jsonl'),
  path.join(telemetryDir, 'lsp-usage.jsonl'),
];

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  const events = readJsonl(file);
  if (events.length === 0) continue;
  const kind = path.basename(file).startsWith('mcp') ? 'MCP' : 'LSP';
  printReport(kind, events, kind === 'MCP' ? 'tool_name' : 'provider');
}

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function printReport(label, events, groupKey) {
  const first = events.map((event) => event.ts).sort()[0];
  const last = events.map((event) => event.ts).sort().at(-1);
  console.log(`\n${label} telemetry`);
  console.log(`${events.length} events from ${first} to ${last}`);
  console.log('name\tcalls\terr%\tmiss%\tavg_ms\tp50_ms\tp95_ms\tp99_ms\tavg_chars\tp95_chars');

  for (const [name, group] of groupBy(events, groupKey)) {
    const durations = group.map((event) => Number(event.duration_ms || 0));
    const chars = group.map((event) => Number(event.output_chars || 0));
    const errors = group.filter((event) => event.error).length;
    const misses = group.filter((event) => event.result_count === 0).length;
    console.log([
      name,
      group.length,
      percent(errors, group.length),
      percent(misses, group.length),
      average(durations).toFixed(1),
      percentile(durations, 0.5),
      percentile(durations, 0.95),
      percentile(durations, 0.99),
      chars.length ? average(chars).toFixed(0) : 'na',
      chars.length ? percentile(chars, 0.95) : 'na',
    ].join('\t'));
  }

  const errorKinds = countBy(events.filter((event) => event.error), (event) => event.error_kind || 'unknown');
  if (errorKinds.length > 0) {
    console.log('\nerror_kind\tcount');
    for (const [kind, count] of errorKinds) {
      console.log(`${kind}\t${count}`);
    }
  }
}

function groupBy(events, key) {
  const groups = new Map();
  for (const event of events) {
    const name = event[key] || 'unknown';
    const group = groups.get(name) || [];
    group.push(event);
    groups.set(name, group);
  }
  return [...groups.entries()].sort((left, right) => right[1].length - left[1].length);
}

function countBy(events, selector) {
  const counts = new Map();
  for (const event of events) {
    const key = selector(event);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}

function average(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function percentile(values, p) {
  if (!values.length) return 'na';
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function percent(count, total) {
  return total ? `${(count / total * 100).toFixed(1)}%` : '0.0%';
}
