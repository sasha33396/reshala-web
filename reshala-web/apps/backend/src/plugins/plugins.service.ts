import { Injectable, Logger } from '@nestjs/common'
import * as fs from 'fs'
import * as path from 'path'
import type { Plugin } from '@reshala-web/shared'

@Injectable()
export class PluginsService {
  private readonly logger = new Logger(PluginsService.name)

  private get pluginsDir(): string {
    const base = process.env.PLUGINS_DIR ?? '/opt/reshala/plugins'
    return path.join(base, 'skynet_commands')
  }

  private walkDir(dir: string): string[] {
    if (!fs.existsSync(dir)) return []
    const results: string[] = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...this.walkDir(full))
      } else if (entry.isFile() && entry.name.endsWith('.sh')) {
        results.push(full)
      }
    }
    return results
  }

  private parseHeaders(filePath: string): { title: string; hidden: boolean } {
    let title = path.basename(filePath, '.sh')
    let hidden = false
    try {
      const fd = fs.openSync(filePath, 'r')
      const buf = Buffer.alloc(2048)
      const bytesRead = fs.readSync(fd, buf, 0, 2048, 0)
      fs.closeSync(fd)
      const head = buf.toString('utf-8', 0, bytesRead)
      for (const line of head.split('\n').slice(0, 30)) {
        const titleMatch = line.match(/^#\s*TITLE:\s*(.+)/)
        if (titleMatch) title = titleMatch[1].trim()
        const hiddenMatch = line.match(/^#\s*SKYNET_HIDDEN:\s*(.+)/)
        if (hiddenMatch) hidden = hiddenMatch[1].trim().toLowerCase() === 'true'
      }
    } catch (err: any) {
      this.logger.warn(`Could not parse headers for ${filePath}: ${err.message}`)
    }
    return { title, hidden }
  }

  private fileToPlugin(filePath: string): Plugin {
    const rel = path.relative(this.pluginsDir, filePath)
    const parts = rel.split(path.sep)
    const category = parts.length > 1 ? parts[0] : 'uncategorized'
    const id = rel.replace(/[\\/]/g, '_').replace(/\.sh$/, '')
    const { title, hidden } = this.parseHeaders(filePath)
    return { id, title, category, path: filePath, hidden }
  }

  scanPlugins(): Plugin[] {
    const files = this.walkDir(this.pluginsDir)
    this.logger.log(`Scanned ${files.length} plugins from ${this.pluginsDir}`)
    return files.map((f) => this.fileToPlugin(f))
  }

  getById(id: string): Plugin | null {
    return this.scanPlugins().find((p) => p.id === id) ?? null
  }
}
