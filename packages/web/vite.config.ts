import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Mock mode imports the committed sample run from ../../runs/sample.json
  server: { port: 5173, strictPort: true, fs: { allow: ["../.."] } },
});
