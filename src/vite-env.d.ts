/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SERVICE_URL?: string;
  readonly VITE_RPC_URL?: string;
  readonly VITE_RPC_WS_URLS?: string;
  readonly VITE_SUBGRAPH_URL?: string;
  readonly VITE_REOWN_PROJECT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
