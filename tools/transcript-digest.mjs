#!/usr/bin/env node
/**
 * Flatten a DSH session transcript (JSONL) into a readable digest.
 *
 * Usage: node tools/transcript-digest.mjs <input.jsonl> [output.md]
 *
 * The transcript stores every model token stream twice: once as chunks in
 * `data.message.stream` and once as finished blocks in `data.message.content`.
 * This script keeps only the finished blocks and drops the chunk arrays, which
 * is roughly a 40x size reduction. Reasoning blocks are kept but folded into a
 * `<details>` element so the visible flow is user turn -> assistant answer ->
 * tool calls. The script is read-only with respect to the transcript.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , inputPath, outputPath] = process.argv;
if (!inputPath) {
  console.error('usage: node tools/transcript-digest.mjs <input.jsonl> [output.md]');
  process.exit(2);
}

const raw = readFileSync(inputPath, 'utf8');
const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== '');

const records = [];
const badLines = [];
lines.forEach((line, index) => {
  try {
    records.push(JSON.parse(line));
  } catch (error) {
    badLines.push({ line: index + 1, error: String(error.message) });
  }
});
records.sort((a, b) => (a.seq ?? -1) - (b.seq ?? -1));

const dateOf = (ms) => (typeof ms === 'number' ? new Date(ms).toISOString().replace('.000', '') : '');
const collapse = (text) => text.replace(/\r\n/g, '\n').trim();

const blockText = (block) => {
  if (!block || typeof block !== 'object') return '';
  if (block.type === 'text') return block.text ?? '';
  if (block.type === 'reasoning') return block.text ?? '';
  if (block.type === 'tool-call') {
    return `\`${block.name}\` ${String(block.arguments ?? '').replace(/\s+/g, ' ')}`;
  }
  return '';
};

const renderContent = (content, { reasoning = true } = {}) => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    const text = blockText(block);
    if (!text) continue;
    if (block.type === 'reasoning') {
      if (reasoning) parts.push(`<details><summary>reasoning</summary>\n\n${collapse(text)}\n\n</details>`);
    } else if (block.type === 'tool-call') {
      parts.push(`- tool call: ${collapse(text)}`);
    } else {
      parts.push(collapse(text));
    }
  }
  return parts.join('\n\n');
};

const out = [];
const push = (line = '') => out.push(line);

const head = records.find((record) => record.type === 'session');
if (head) {
  push('# Session transcript digest');
  push();
  push(`| field | value |`);
  push('| --- | --- |');
  push(`| file | \`${inputPath}\` |`);
  push(`| session | \`${head.id}\` (version ${head.version}) |`);
  push(`| cwd | \`${head.cwd}\` |`);
  push(`| created | ${dateOf(head.createdAt)} |`);
  push(`| records | ${records.length} (${badLines.length} unparseable) |`);
  push();
}

const counts = new Map();
for (const record of records) counts.set(record.type, (counts.get(record.type) ?? 0) + 1);
push('## Record counts');
push();
push('| type | count |');
push('| --- | --- |');
for (const [type, count] of [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
  push(`| \`${type}\` | ${count} |`);
}
push();

const goals = records.filter((record) => record.type === 'goal/change');
if (goals.length > 0) {
  push('## Goals');
  push();
  for (const record of goals) {
    const goal = record.data?.goal ?? {};
    const objective = String(goal.objective ?? '').replace(/\s+/g, ' ').trim();
    push(`- ${dateOf(record.time)} — \`${record.data?.operation}\` — ${objective}`);
  }
  push();
}

push('## Conversation');
push();
let pendingToolCalls = [];
for (const record of records) {
  const { type, time, data } = record;
  if (type === 'user/message' || type === 'system/message') {
    const body = renderContent(data?.content ?? data?.message?.content ?? data);
    const kind = data?.source?.kind ? ` (${data.source.kind})` : '';
    push(`### ${dateOf(time)} — ${type === 'user/message' ? 'USER' : 'SYSTEM'}${kind}`);
    push();
    push(collapse(body));
    push();
  } else if (type === 'assistant/message') {
    const body = renderContent(data?.message?.content);
    if (body.trim() === '') continue;
    push(`### ${dateOf(time)} — assistant, turn ${data?.turn ?? '?'} step ${data?.step ?? '?'}`);
    push();
    push(collapse(body));
    push();
  } else if (type === 'tool/call') {
    const args = String(data?.arguments ?? '').replace(/\s+/g, ' ');
    pendingToolCalls.push(`- \`${data?.name ?? '?'}\` ${args.length > 400 ? `${args.slice(0, 400)}…` : args}`);
  } else if (type === 'tool/result' && pendingToolCalls.length > 0) {
    const isError = data?.message?.isError === true;
    const text = renderContent(data?.message?.content);
    const size = text.length;
    push(`<details><summary>tool calls (${pendingToolCalls.length})${isError ? ' — one errored' : ''}</summary>`);
    push();
    for (const call of pendingToolCalls) push(call);
    push();
    push(`</details>`);
    push();
    pendingToolCalls = [];
  }
}
if (pendingToolCalls.length > 0) {
  push('<details><summary>tool calls (unpaired)</summary>');
  push();
  for (const call of pendingToolCalls) push(call);
  push();
  push('</details>');
  push();
}

if (badLines.length > 0) {
  push('## Unparseable lines');
  push();
  for (const bad of badLines) push(`- line ${bad.line}: ${bad.error}`);
}

const digest = `${out.join('\n')}\n`;
if (outputPath) {
  writeFileSync(outputPath, digest, 'utf8');
  console.log(`wrote ${outputPath}: ${digest.length} bytes from ${records.length} records`);
} else {
  process.stdout.write(digest);
}
