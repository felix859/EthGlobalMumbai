/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** Where the agent's HTTP API runs (issue #4). Default http://localhost:4000 */
  readonly VITE_AGENT_URL?: string;
}
