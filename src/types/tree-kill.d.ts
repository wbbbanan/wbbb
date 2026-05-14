declare module 'tree-kill' {
  function kill(
    pid: number,
    signal: string | undefined,
    callback: (error?: Error | null) => void,
  ): void;

  export default kill;
}