/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly NEO4J_URI: string;
  readonly NEO4J_USER: string;
  readonly NEO4J_PASSWORD: string;
  readonly NEO4J_DATABASE: string;
  readonly GEMINI_API_KEY?: string;
}
