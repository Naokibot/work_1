export function localDateKey(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function sameLocalDate(a: Date | string | number, b: Date | string | number): boolean {
  const left = localDateKey(a);
  return Boolean(left) && left === localDateKey(b);
}
