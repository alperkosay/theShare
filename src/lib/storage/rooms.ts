/**
 * 6-digit code rooms used recently on this device, so a shared link stays
 * usable: the creator can reopen the same room (same code, same link) and the
 * other side can rejoin it. Kept in localStorage, never sent anywhere.
 *
 * A room is only a code: reopening it waits on the trackers again like a new
 * code would, and the connection is approved and verified the same way.
 */
export interface RecentRoom {
  code: string;
  /** 'host': this device created the code. 'join': it entered it. */
  role: 'host' | 'join';
  /** Last time the room was created, joined or reopened. */
  at: number;
}

/** A room can be reopened for this long after it was last used. */
export const ROOM_TTL_MS = 24 * 60 * 60_000;
export const MAX_ROOMS = 3;

const STORAGE_KEY = 'theshare-rooms';

/** Drops expired and malformed rooms; newest first. */
export function liveRooms(rooms: RecentRoom[], now = Date.now()): RecentRoom[] {
  return rooms
    .filter((r) => /^\d{6}$/.test(r.code) && (r.role === 'host' || r.role === 'join') && now - r.at < ROOM_TTL_MS && r.at <= now)
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_ROOMS);
}

/** Adds or refreshes a room. The latest role wins: a code both created and entered here is whatever we did last. */
export function addRoom(rooms: RecentRoom[], room: RecentRoom, now = Date.now()): RecentRoom[] {
  return liveRooms([room, ...rooms.filter((r) => r.code !== room.code)], now);
}

export function loadRooms(): RecentRoom[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? liveRooms(parsed as RecentRoom[]) : [];
  } catch {
    return [];
  }
}

export function saveRooms(rooms: RecentRoom[]): void {
  try {
    if (rooms.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked (private mode): rooms last for this visit only.
  }
}
