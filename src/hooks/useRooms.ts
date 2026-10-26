import { useSyncExternalStore } from 'react';
import { addRoom, liveRooms, loadRooms, saveRooms, type RecentRoom } from '../lib/storage/rooms';
import type { Role } from './useSession';

/** Recent 6-digit code rooms (lib/storage/rooms), for "reopen / rejoin". */
class RoomStore {
  private rooms: RecentRoom[] = loadRooms();
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.rooms;

  private set(rooms: RecentRoom[]) {
    this.rooms = rooms;
    saveRooms(rooms);
    for (const l of this.listeners) l();
  }

  remember(code: string, role: Role): void {
    this.set(addRoom(this.rooms, { code, role, at: Date.now() }));
  }

  forget(code: string): void {
    this.set(this.rooms.filter((r) => r.code !== code));
  }

  clear(): void {
    this.set([]);
  }

  /** True if this device created that code recently: opening its link should reopen the room, not join it. */
  isOwn(code: string): boolean {
    return liveRooms(this.rooms).some((r) => r.code === code && r.role === 'host');
  }
}

export const rooms = new RoomStore();

export function useRooms(): RecentRoom[] {
  return useSyncExternalStore(rooms.subscribe, rooms.getSnapshot);
}
