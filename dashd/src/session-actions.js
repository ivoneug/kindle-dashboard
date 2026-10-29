// Mutating session actions must target the session on the displayed frame,
// rather than whichever session a newer snapshot has moved under the cursor.
export function canCompactFrame(frame, id) {
  return !!id && frame?.meta?.sessionId === id && ['sessions', 'detail'].includes(frame.meta.screen);
}
