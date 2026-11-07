/** Realtime Broadcast topic of a room. Prefixed: the Supabase project is shared by several games. */
export const roomTopic = (roomId: string) => `yams:room:${roomId}`;
