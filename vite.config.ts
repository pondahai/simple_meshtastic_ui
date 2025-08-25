import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: [
      "@meshtastic/core",
      "@meshtastic/transport-web-serial",
      "@meshtastic/protobufs",
      "ste-simple-events",
      "tslog"
    ]
  },
  resolve: {
    conditions: ["browser", "module", "import", "default"]
  },
  server: {
    port: 5173,
    host: true
  }
})