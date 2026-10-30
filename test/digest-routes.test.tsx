import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest } from '../src/digest/types.js';

const night = '2026-10-28';
let runsDir: string;

beforeEach(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
});

afterEach(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

function writeNight(lines: string[]) {
  writeFileSync(join(runsDir, `${night}.jsonl`), lines.length ? `${lines.join('\n')}\n` : '');
}

function htmlRows(html: string) {
  return Array.from(html.matchAll(/<tr(?: class="([^"]+)")?>(.*?)<\/tr>/gs), ([, className, content]) => ({
    className,
    cells: Array.from(content.matchAll(/<td>(.*?)<\/td>/gs), ([, cell]) => cell),
  })).filter((row) => row.cells.length > 0);
}

describe('digest routes', () => {
  it('returns the digest as JSON and a sorted, matching HTML table', async () => {
    writeNight([
      JSON.stringify({ at: '2026-10-28T06:12:00-04:00', job: 'zeta', status: 'ok', owner: null }),
      JSON.stringify({ at: '2026-10-28T07:00:00+02:00', job: 'alpha', status: 'retry', owner: 'api', error: 'temporary' }),
      JSON.stringify({ at: '2026-10-28T07:01:00+02:00', job: 'alpha', status: 'retry', owner: 'api', error: 'temporary' }),
      'not json',
      JSON.stringify({ at: '2026-10-28T07:02:00+02:00', job: 'alpha', status: 'retry', owner: 'api', error: 'temporary' }),
      JSON.stringify({ at: '2026-10-28T07:03:00+02:00', job: 'alpha', status: 'ok', owner: 'api' }),
      JSON.stringify({ at: '2026-10-28T08:00:00+02:00', job: 'mu', status: 'fail', owner: 'worker', error: 'gave up' }),
    ]);

    const app = createApp({ adapter: 'shim', installed: '', beatEverySeconds: 60, runsDir });
    const [jsonResponse, htmlResponse, boardResponse] = await Promise.all([
      app.request(`/api/digest/${night}`),
      app.request(`/digest/${night}`),
      app.request('/'),
    ]);
    const digest = await jsonResponse.json() as NightDigest;
    const html = await htmlResponse.text();
    const board = await boardResponse.text();

    expect(jsonResponse.status).toBe(200);
    expect(digest).toMatchObject({
      badLines: 1,
      counts: { ok: 2, retry: 3, fail: 1 },
      rows: [
        {
          job: 'alpha', owner: 'api', runs: 4, retries: 3, lastStatus: 'ok', lastError: 'temporary',
          firstTime: '2026-10-28T07:00:00+02:00', lastTime: '2026-10-28T07:03:00+02:00', hasFailure: false,
        },
        {
          job: 'mu', owner: 'worker', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'gave up',
          firstTime: '2026-10-28T08:00:00+02:00', lastTime: '2026-10-28T08:00:00+02:00', hasFailure: true,
        },
        {
          job: 'zeta', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstTime: '2026-10-28T06:12:00-04:00', lastTime: '2026-10-28T06:12:00-04:00', hasFailure: false,
        },
      ],
    });

    expect(htmlResponse.status).toBe(200);
    expect(html).toContain('bad lines: 1');
    expect(html).toContain('2026-10-28T06:12:00-04:00');
    const rows = htmlRows(html);
    expect(rows.map((row) => row.cells[0])).toEqual(digest.rows.map((row) => row.job));
    expect(rows[0].className).toBe('warn');
    expect(rows[1].className).toBe('warn');
    expect(rows[2].className).toBeUndefined();
    expect(rows[2].cells[1]).toBe('—');
    expect(boardResponse.status).toBe(200);
    expect(board).toContain(`<a href="/digest/${night}">${night}</a>`);
    expect(board).toMatch(/2 ok\s*\/\s*3 retry\s*\/\s*1 fail/);
  });

  it('returns 404 for missing nights and an empty digest for an empty file', async () => {
    const app = createApp({ adapter: 'shim', installed: '', beatEverySeconds: 60, runsDir });

    expect((await app.request(`/digest/${night}`)).status).toBe(404);
    expect((await app.request(`/api/digest/${night}`)).status).toBe(404);

    writeNight([]);
    const [htmlResponse, jsonResponse] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);

    expect(htmlResponse.status).toBe(200);
    expect(await htmlResponse.text()).toContain('nothing ran');
    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toEqual({
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });
});
