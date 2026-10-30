export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  lastError: string | null;
  firstTime: string;
  lastTime: string;
  hasFailure: boolean;
};

export type NightDigest = {
  rows: DigestRow[];
  badLines: number;
  counts: Record<RunStatus, number>;
};

// Reads <runsDir>/<night>.jsonl synchronously; null means the night is missing.
// Rows sort by job. Counts count valid events, including retries and failures.
// First/last follow log order, keeping the source timestamps and offsets intact.
// Owner/status follow the last event; lastError is the last error encountered.
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
