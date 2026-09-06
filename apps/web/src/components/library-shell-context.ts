import { createContext, useContext } from "react";

const LibraryShellContext = createContext({ openImport: () => {} });

export function useLibraryShell() {
  return useContext(LibraryShellContext);
}

export { LibraryShellContext };
