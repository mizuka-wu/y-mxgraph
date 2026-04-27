export function createCursorImage(color: string) {
  const w = 8;
  const h = 12;
  const path =
    '<path d="M 4 0 L 8 12 L 4 10 L 0 12 Z" stroke="' +
    color +
    '" fill="' +
    color +
    '"/>';
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    w +
    'px" height="' +
    h +
    'px" viewBox="0 0 ' +
    w +
    " " +
    h +
    '" version="1.1">' +
    path +
    "</svg>";
  const bytes = new Uint8Array(svg.length);
  for (let i = 0; i < svg.length; i++) {
    bytes[i] = svg.charCodeAt(i);
  }
  const encoded = btoa(String.fromCharCode.apply(null, bytes as unknown as number[]));
  return "data:image/svg+xml;base64," + encoded;
}
