export function generateColor(seed: string | number) {
  const hash = hashString(String(seed));
  const h = hash % 360;
  const s = 65 + ((hash >>> 8) % 20); // 65-84
  const l = 55 + ((hash >>> 16) % 10); // 55-64
  return hslToHex(h, s, l);
}

export function generateRandomName(): string {
  if (typeof crypto !== 'undefined') {
    // Prefer UUID when available
    // @ts-ignore
    if (typeof crypto.randomUUID === 'function') {
      // @ts-ignore
      return crypto.randomUUID();
    }
    // Crypto-based fallback
    // @ts-ignore
    if (typeof crypto.getRandomValues === 'function') {
      // @ts-ignore
      const bytes = new Uint8Array(16);
      // @ts-ignore
      crypto.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
  }
  // Time + random fallback
  return (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).toLowerCase();
}
 
 export function generateRandomId(): string {
   return generateRandomName();
 }

// Helpers
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return hash >>> 0; // unsigned 32-bit
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0, g1 = 0, b1 = 0;
  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp >= 1 && hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp >= 2 && hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp >= 3 && hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp >= 4 && hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = l - c / 2;
  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}
