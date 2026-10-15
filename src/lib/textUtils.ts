export function replaceAll(str: string, find: string, replace: string): string {
  if (!find) return str;
  return str.split(find).join(replace);
}
