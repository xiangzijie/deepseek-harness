import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_VISION_MODEL,
  describeScreenshots,
  fileToDataUrl,
  mediaTypeForPath,
} from '../src/vision-preflight.ts'

describe('mediaTypeForPath / fileToDataUrl', () => {
  it('maps common raster extensions', () => {
    expect(mediaTypeForPath('a.PNG')).toBe('image/png')
    expect(mediaTypeForPath('a.jpg')).toBe('image/jpeg')
    expect(mediaTypeForPath('a.txt')).toBeNull()
  })

  it('encodes a small png as a data URL', () => {
    const dir = join(tmpdir(), `dsh-vision-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'shot.png')
    // Minimal valid-ish bytes for encoding tests (API not called here).
    writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    const url = fileToDataUrl(path, 1024)
    expect(url).toMatch(/^data:image\/png;base64,/)
  })
})

describe('describeScreenshots', () => {
  it('returns error when there are no paths', async () => {
    await expect(
      describeScreenshots([], { apiKey: 'sk-test' }),
    ).resolves.toEqual({ ok: false, error: expect.stringMatching(/无本地截图/) })
  })

  it('POSTs multimodal chat.completions and returns assistant text', async () => {
    const dir = join(tmpdir(), `dsh-vision-${Date.now()}-api`)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'ui.png')
    writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))

    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        model: string
        messages: Array<{ content: unknown[] }>
      }
      expect(body.model).toBe(DEFAULT_VISION_MODEL)
      expect(body.messages[0]?.content.some(part => (part as { type: string }).type === 'image_url')).toBe(
        true,
      )
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '页面顶部有错误红字：所属区域为空。' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })

    const result = await describeScreenshots([path], {
      apiKey: 'sk-test',
      ticketId: 490,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({
      ok: true,
      text: '页面顶部有错误红字：所属区域为空。',
      usedPaths: [path],
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('returns structured error on non-2xx', async () => {
    const dir = join(tmpdir(), `dsh-vision-${Date.now()}-err`)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'ui.png')
    writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const result = await describeScreenshots([path], {
      apiKey: 'sk-test',
      fetchImpl: (async () =>
        new Response('nope', { status: 401 })) as unknown as typeof fetch,
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected err')
    expect(result.error).toMatch(/401/)
  })
})
