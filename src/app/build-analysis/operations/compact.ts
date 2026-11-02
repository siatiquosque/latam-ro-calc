/** Omit absent optional fields in both browser results and MCP responses. */
export const compact = <T extends Record<string, any>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
