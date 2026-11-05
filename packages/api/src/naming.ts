/** "user-settings" → "userSettings". */
export function camel(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_, character: string) => character.toUpperCase());
}

/** "listProducts" → "ListProducts". */
export function upperFirst(name: string): string {
  return name[0].toUpperCase() + name.slice(1);
}

/** "user-settings" → "UserSettings". */
export function pascal(name: string): string {
  return upperFirst(camel(name));
}
