import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'local-input-loader',
      configureServer(server) {
        server.middlewares.use('/api/local-file', async (request, response) => {
          try {
            const url = new URL(request.url || '', 'http://localhost')
            const filePath = url.searchParams.get('path')
            if (!filePath) {
              response.statusCode = 400
              response.end('Missing path')
              return
            }
            const ext = extname(filePath).toLowerCase()
            if (!['.csv', '.xlsx', '.xlsm', '.xls'].includes(ext)) {
              response.statusCode = 400
              response.end('Unsupported file type')
              return
            }
            const buffer = await readFile(filePath)
            response.setHeader('Content-Type', ext === '.csv' ? 'text/csv; charset=utf-8' : 'application/octet-stream')
            response.setHeader('X-File-Name', encodeURIComponent(basename(filePath)))
            response.end(buffer)
          } catch (error) {
            response.statusCode = 500
            response.end(error instanceof Error ? error.message : 'Failed to read file')
          }
        })
      },
    },
  ],
})
