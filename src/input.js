// ===== input.js =====
// Shared input helpers for game hotkeys and text-entry focus guards.

export function isTextInputTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function shouldHandleGameKey(event) {
  return !isTextInputTarget(event.target);
}

export function createKeyState(target = document) {
  const keys = {};
  target.addEventListener('keydown', event => {
    if (shouldHandleGameKey(event)) keys[event.code] = true;
  });
  target.addEventListener('keyup', event => {
    keys[event.code] = false;
  });
  return keys;
}
