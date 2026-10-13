# Transcript digest (generated)

`digest.md` in this directory is generated from `session.v4.jsonl` by
`tools/transcript-digest.mjs`. The script strips per-token streams
(`stream`, `*-chunks`) and flattens message content to text so the transcript
can be read without the 5 MB of chunk data. Regenerate with:

```
node tools/transcript-digest.mjs docs/session-archive/session.v4.jsonl docs/session-archive/digest.md
```
