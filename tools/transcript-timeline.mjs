#!/usr/bin/env node
/**
 * Print a compact user-turn timeline from a DSH session transcript (JSONL).
 *
 * Usage: node tools/transcript-timeline.mjs <input.jsonl>
 *
 * Unlike tools/transcript-digest.mjs this keeps only the human/system turns
 * (skipping the harness's own system prompt) plus the final assistant answer,
 * so a long session can be skimmed in one screen. Read-only.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flags = args.filter((arg) => arg.startsWith('--'));
const positional = args.filter((arg) => !arg.startsWith('--'));
const [inputPath, outputPath] = positional;
if (!inputPath) {
  console.error('usage: node tools/transcript-timeline.mjs <input.jsonl> [output.txt] [--with-assistant]');
  process.exit(2);
}
const withAssistant = flags.includes('--with-assistant');
const limit = Number(process.env.LIMIT ?? 1200);
const lines = [];
const say = (line = '') => {
  if (outputPath) lines.push(line);
  else console.log(line);
};

const records = readFileSync(inputPath, 'utf8')
  .split(/\r?\n/)
  .filter((line) => line.trim() !== '')
  .map((line) => JSON.parse(line))
  .sort((a, b) => (a.seq ?? -1) - (b.seq ?? -1));

const asText = (content) => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block?.type === 'text')
    .map((block) => block.text)
    .join('\n');
};
const stamp = (ms) => (typeof ms === 'number' ? new Date(ms).toISOString().slice(0, 19).replace('T', ' ') : '?');
const clip = (text) => {
  const flat = text.replace(/\r/g, '').trim();
  return flat.length > limit ? `${flat.slice(0, limit)}\n… [${flat.length - limit} more chars]` : flat;
};

for (const record of records) {
  const { type, time, data } = record;
  if (type === 'user/message' || type === 'system/message') {
    const body = asText(data?.content);
    // The harness prompt is long, machine-authored, and identical every session.
    if (body.includes('You are an AI agent powered by DeepSeek Harness')) continue;
    if (body.startsWith('<system-reminder>')) continue;
    if (body.trim() === '') continue;
    const kind = data?.source?.kind ?? 'user';
    say(`\n===== ${stamp(time)} [${kind}] =====`);
    say(clip(body));
  } else if (type === 'assistant/message' && withAssistant) {
    const body = asText(data?.message?.content);
    if (body.trim() === '') continue;
    say(`\n----- ${stamp(time)} assistant (turn ${data?.turn} step ${data?.step}) -----`);
    say(clip(body));
  } else if (type === 'session/title') {
    say(`\n[title] ${data?.title ?? ''}`);
  } else if (type === 'goal/change') {
    say(`\n[goal ${data?.operation}] ${clip(String(data?.goal?.objective ?? ''))}`);
  } else if (type === 'deliverables/presented') {
    say(`\n[deliverables] ${JSON.stringify(data?.files ?? data).slice(0, 600)}`);
  }
}

if (outputPath) {
  writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`wrote ${outputPath}: ${lines.length} lines`);
}
