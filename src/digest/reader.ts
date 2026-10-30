import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, NightDigest, ReadNight, RunStatus } from './types.js';

type Run = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

function isRun(value: unknown): value is Run {
  if (typeof value !== 'object' || value === null) return false;
  const run = value as Record<string, unknown>;
  return typeof run.at === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(run.at)
    && Number.isFinite(Date.parse(run.at))
    && typeof run.job === 'string' && run.job.trim().length > 0
    && (run.status === 'ok' || run.status === 'retry' || run.status === 'fail')
    && (typeof run.owner === 'string' || run.owner === null)
    && (run.error === undefined || typeof run.error === 'string');
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;

  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  const digest: NightDigest = { rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
  const jobs = new Map<string, DigestRow>();
  const lines = contents === '' ? [] : contents.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();

  for (const line of lines) {
    let run: unknown;
    try {
      run = JSON.parse(line);
    } catch {
      digest.badLines++;
      continue;
    }
    if (!isRun(run)) {
      digest.badLines++;
      continue;
    }

    digest.counts[run.status]++;
    const row = jobs.get(run.job) ?? {
      job: run.job,
      owner: run.owner,
      runs: 0,
      retries: 0,
      lastStatus: run.status,
      lastError: null,
      firstTime: run.at,
      lastTime: run.at,
      hasFailure: false,
    };
    row.owner = run.owner;
    row.runs++;
    if (run.status === 'retry') row.retries++;
    row.lastStatus = run.status;
    if (run.error !== undefined) row.lastError = run.error;
    row.lastTime = run.at;
    row.hasFailure ||= run.status === 'fail';
    jobs.set(run.job, row);
  }

  digest.rows = [...jobs.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return digest;
};
