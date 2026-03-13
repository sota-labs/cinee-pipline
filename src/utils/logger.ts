/** Simple structured logger. */

function timestamp(): string {
  return new Date().toISOString();
}

export const log = {
  info(msg: string): void {
    console.log(`[${timestamp()}] INFO  ${msg}`);
  },
  warn(msg: string): void {
    console.warn(`[${timestamp()}] WARN  ${msg}`);
  },
  error(msg: string): void {
    console.error(`[${timestamp()}] ERROR ${msg}`);
  },
  debug(msg: string): void {
    if (process.env.NODE_ENV === "development") {
      console.debug(`[${timestamp()}] DEBUG ${msg}`);
    }
  },
};
