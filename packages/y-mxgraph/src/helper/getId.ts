export function getId(item: { id?: string | number }) {
  if (item.id) return item.id;
  return null;
}
