export function createCursorImage(Graph: any, color: string) {
  return Graph.createSvgImage(
    8,
    12,
    '<path d="M 4 0 L 8 12 L 4 10 L 0 12 Z" stroke="' +
      color +
      '" fill="' +
      color +
      '"/>'
  ).src;
}
