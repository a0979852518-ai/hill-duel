export function toast(text: string, isError = false, ms = 2600): void {
  const layer = document.getElementById('toast-layer');
  if (!layer) return;
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : '');
  el.textContent = text;
  layer.appendChild(el);
  setTimeout(() => el.remove(), ms);
}
