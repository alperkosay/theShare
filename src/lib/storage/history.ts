import type { DeviceKind, DeviceOs } from '../device';

export type HistoryStatus = 'done' | 'failed' | 'cancelled' | 'rejected';

export interface HistoryEntry {
  id: string;
  at: number;
  direction: 'out' | 'in';
  kind: 'files' | 'text';
  files?: { name: string; size: number; type: string }[];
  /** Only when "add texts to history" is on; first TEXT_PREVIEW_LENGTH characters. */
  textPreview?: string;
  totalBytes: number;
  status: HistoryStatus;
  peer: { id?: string; name: string; kind: DeviceKind; os: DeviceOs };
  method: 'nearby' | 'code' | 'qr';
  /** Record in the files store (handles or copies), if one was kept. */
  resendKey?: string;
}

/** What the files store keeps for one entry: either handles (Chromium desktop) or copies. */
export type ResendRecord =
  | { key: string; at: number; bytes: number; mode: 'handle'; items: FileSystemFileHandle[] }
  | { key: string; at: number; bytes: number; mode: 'copy'; items: File[] };

export const TEXT_PREVIEW_LENGTH = 200;
/** Copies kept for resend, in total and per file. Oldest copies go first when the total is exceeded. */
export const COPY_LIMIT_BYTES = 2 * 1024 ** 3;
export const COPY_FILE_LIMIT_BYTES = 500 * 1024 ** 2;

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Groups newest-first entries by calendar day: "Bugün", "Dün", then the date. */
export function groupByDay(entries: HistoryEntry[], now = Date.now()): Array<{ label: string; entries: HistoryEntry[] }> {
  const today = startOfDay(now);
  const groups: Array<{ label: string; day: number; entries: HistoryEntry[] }> = [];
  for (const entry of entries) {
    const day = startOfDay(entry.at);
    let group = groups.at(-1);
    if (group?.day !== day) {
      const label =
        day === today
          ? 'Bugün'
          : // Compare by date, not by 24 h: DST days are 23 or 25 hours long.
            day === startOfDay(today - DAY_MS / 2)
            ? 'Dün'
            : new Date(day).toLocaleDateString('tr-TR', {
                day: 'numeric',
                month: 'long',
                ...(new Date(day).getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }),
              });
      group = { label, day, entries: [] };
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return groups.map(({ label, entries }) => ({ label, entries }));
}

export type DirectionFilter = 'all' | 'out' | 'in';

/** Turkish-aware, case-insensitive search over file names, text preview and the peer's name. */
export function filterHistory(entries: HistoryEntry[], direction: DirectionFilter, query: string): HistoryEntry[] {
  const q = query.trim().toLocaleLowerCase('tr');
  return entries.filter((e) => {
    if (direction !== 'all' && e.direction !== direction) return false;
    if (!q) return true;
    const haystack = [e.peer.name, e.textPreview ?? '', ...(e.files ?? []).map((f) => f.name)].join('\n').toLocaleLowerCase('tr');
    return haystack.includes(q);
  });
}

/** Entries past the retention period. */
export function expiredEntries(entries: HistoryEntry[], retentionDays: number | null, now = Date.now()): HistoryEntry[] {
  if (retentionDays === null) return [];
  const cutoff = now - retentionDays * DAY_MS;
  return entries.filter((e) => e.at < cutoff);
}

/**
 * Decides whether a new copy of `files` can be kept, and which older copies
 * must go to stay under the limit. Returns null if the new copy can't be kept
 * at all (a file is over the per-file limit, or the total alone is too big).
 */
export function planCopy(
  existing: Array<{ key: string; at: number; bytes: number }>,
  files: Array<{ size: number }>,
  limit = COPY_LIMIT_BYTES,
  fileLimit = COPY_FILE_LIMIT_BYTES,
): { evict: string[] } | null {
  const bytes = files.reduce((sum, f) => sum + f.size, 0);
  if (files.some((f) => f.size > fileLimit) || bytes > limit) return null;
  let used = existing.reduce((sum, r) => sum + r.bytes, 0);
  const evict: string[] = [];
  for (const r of [...existing].sort((a, b) => a.at - b.at)) {
    if (used + bytes <= limit) break;
    evict.push(r.key);
    used -= r.bytes;
  }
  return { evict };
}

/** "Alper'e 12 dosya gönderdin" style totals for one device. */
export function peerTotals(entries: HistoryEntry[], peerId: string): { sent: number; received: number } {
  let sent = 0;
  let received = 0;
  for (const e of entries) {
    if (e.peer.id !== peerId || e.kind !== 'files' || e.status !== 'done') continue;
    if (e.direction === 'out') sent += e.files?.length ?? 0;
    else received += e.files?.length ?? 0;
  }
  return { sent, received };
}
