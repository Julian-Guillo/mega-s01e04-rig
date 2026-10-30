import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
const event = { at: '2026-10-28T23:00:00+01:00', job: 'job', status: 'ok', owner: 'rook' };
let runsDir: string;

beforeEach(() => { runsDir = mkdtempSync(join(tmpdir(), 'rig-reader-')); });
afterEach(() => { rmSync(runsDir, { recursive: true, force: true }); });

function writeNight(lines: unknown[]) {
  writeFileSync(join(runsDir, `${night}.jsonl`), lines.map((line) => JSON.stringify(line)).join('\n'));
}

describe('readNight', () => {
  it('aggregates the supplied night without changing its source timestamps', () => {
    const digest = readNight('runs', night)!;
    expect(digest.badLines).toBe(1);
    expect(digest.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest.rows.map((row) => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest.rows[0].owner).toBeNull();
    expect(digest.rows[1]).toEqual({
      job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3,
      lastStatus: 'ok', lastError: 'upstream 503',
      firstTime: '2026-10-29T01:30:00+01:00', lastTime: '2026-10-29T01:37:00+01:00',
      hasFailure: false,
    });
    expect(digest.rows[2]).toMatchObject({ runs: 8, retries: 1, lastError: 'lock held' });
    expect(digest.rows[3]).toMatchObject({ hasFailure: true, lastStatus: 'fail', lastError: 'quota exceeded' });
  });

  it('distinguishes missing nights from empty files and rejects paths', () => {
    expect(readNight(runsDir, night)).toBeNull();
    writeFileSync(join(runsDir, `${night}.jsonl`), '');
    expect(readNight(runsDir, night)).toEqual({ rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
    for (const name of ['../2026-10-28', '/2026-10-28', '2026-10-28.jsonl']) {
      expect(readNight(runsDir, name)).toBeNull();
    }
  });

  it('counts invalid JSON and invalid records while retaining valid rows', () => {
    const path = join(runsDir, `${night}.jsonl`);
    writeFileSync(path, 'broken JSON\n\n' + [
      null, [], 42, {},
      { ...event, at: 'not a time' }, { ...event, job: '' },
      { ...event, status: 'unknown' }, { ...event, owner: 12 },
      { ...event, owner: undefined }, { ...event, error: null }, event,
    ].map((line) => JSON.stringify(line)).join('\r\n') + '\r\n');
    const digest = readNight(runsDir, night)!;
    expect(digest.badLines).toBe(12);
    expect(digest.rows).toHaveLength(1);
    expect(digest.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
  });

  it('keeps failure history and the last error after recovery, with log order and offsets', () => {
    writeNight([
      { ...event, status: 'fail', error: 'first error' },
      { ...event, at: '2026-10-28T22:01:00-02:00', status: 'retry', error: 'last error' },
      { ...event, at: '2026-10-28T22:02:00-02:00', owner: null },
    ]);
    expect(readNight(runsDir, night)!.rows).toEqual([{
      job: 'job', owner: null, runs: 3, retries: 1, lastStatus: 'ok',
      lastError: 'last error', hasFailure: true,
      firstTime: event.at, lastTime: '2026-10-28T22:02:00-02:00',
    }]);
  });
});
