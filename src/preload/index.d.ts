export interface PrismaBridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, cb: (...args: never[]) => void): () => void
  pathFor(file: File): string
}

declare global {
  interface Window {
    prisma?: PrismaBridge
  }
}
