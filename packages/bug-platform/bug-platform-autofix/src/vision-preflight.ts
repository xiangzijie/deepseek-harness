/**
 * Official DeepSeek vision pre-pass: describe local screenshots as text for
 * the headless brief (autofix design scheme A). Does not change the text-only
 * headless coding path.
 * @module @deepseek-ai/dsh-bug-platform-autofix/vision-preflight
 */

import { readFileSync } from 'node:fs'
import { extname } from 'node:path'

/** Default wire model id for official DeepSeek multimodal. */
export const DEFAULT_VISION_MODEL = 'deepseek-flash'

/** Default public DeepSeek API root. */
export const DEFAULT_VISION_BASE_URL = 'https://api.deepseek.com'

/** Max screenshots sent in one vision request. */
export const DEFAULT_MAX_VISION_IMAGES = 4

/** Max encoded file size per image (bytes) before skipping that file. */
export const DEFAULT_MAX_BYTES_PER_IMAGE = 4 * 1024 * 1024

/** Options for {@link describeScreenshots}. */
export interface VisionPreflightOptions {
  /** DeepSeek API key (never log). */
  apiKey: string
  /** API root; defaults to {@link DEFAULT_VISION_BASE_URL}. */
  baseURL?: string
  /** Wire model id; defaults to {@link DEFAULT_VISION_MODEL}. */
  model?: string
  /** Cap on images included; defaults to {@link DEFAULT_MAX_VISION_IMAGES}. */
  maxImages?: number
  /** Per-file size cap; defaults to {@link DEFAULT_MAX_BYTES_PER_IMAGE}. */
  maxBytesPerImage?: number
  /** Injectable fetch (tests). */
  fetchImpl?: typeof fetch
  /** Optional ticket id for the prompt framing. */
  ticketId?: number
}

/** Successful vision observation text for the agent brief. */
export type VisionPreflightOk = {
  ok: true
  /** Chinese observation paragraph(s) for brief injection. */
  text: string
  /** Local paths that were actually sent. */
  usedPaths: readonly string[]
}

/** Vision call failed; caller may continue without blocking claim. */
export type VisionPreflightErr = {
  ok: false
  error: string
}

/**
 * Map a local image path to an `image/*` media type for a data URL.
 * @param path - filesystem path.
 * @returns media type, or null when the extension is not a supported raster.
 */
export function mediaTypeForPath(path: string): string | null {
  switch (extname(path).toLowerCase()) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    default:
      return null
  }
}

/**
 * Build a `data:` URL for one local image file.
 * @param path - absolute path to a raster file.
 * @param maxBytes - skip (return null) when file is larger.
 * @returns data URL, or null when unsupported / too large / unreadable.
 */
export function fileToDataUrl(path: string, maxBytes: number): string | null {
  const mediaType = mediaTypeForPath(path)
  if (mediaType === null) return null
  let bytes: Buffer
  try {
    bytes = readFileSync(path)
  } catch {
    return null
  }
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) return null
  return `data:${mediaType};base64,${bytes.toString('base64')}`
}

/**
 * Call official DeepSeek chat-completions with screenshot data URLs and return
 * a Chinese observation suitable for the autofix brief.
 * @param screenshotPaths - local paths from asset download.
 * @param options - API key, model, limits, optional fetch.
 * @returns observation text or a structured error (never throws for HTTP/body faults).
 */
export async function describeScreenshots(
  screenshotPaths: readonly string[],
  options: VisionPreflightOptions,
): Promise<VisionPreflightOk | VisionPreflightErr> {
  if (screenshotPaths.length === 0) {
    return { ok: false, error: '无本地截图，跳过视觉预跑' }
  }
  const apiKey = options.apiKey.trim()
  if (apiKey.length === 0) {
    return { ok: false, error: '缺少 DEEPSEEK_API_KEY，跳过视觉预跑' }
  }

  const maxImages = options.maxImages ?? DEFAULT_MAX_VISION_IMAGES
  const maxBytes = options.maxBytesPerImage ?? DEFAULT_MAX_BYTES_PER_IMAGE
  const model = options.model?.trim() || DEFAULT_VISION_MODEL
  const baseURL = (options.baseURL?.trim() || DEFAULT_VISION_BASE_URL).replace(/\/$/, '')
  const fetchImpl = options.fetchImpl ?? globalThis.fetch

  const usedPaths: string[] = []
  const imageParts: Array<{ type: 'image_url'; image_url: { url: string } }> = []
  for (const path of screenshotPaths) {
    if (imageParts.length >= maxImages) break
    const dataUrl = fileToDataUrl(path, maxBytes)
    if (dataUrl === null) continue
    usedPaths.push(path)
    imageParts.push({ type: 'image_url', image_url: { url: dataUrl } })
  }
  if (imageParts.length === 0) {
    return { ok: false, error: '截图无法编码为 data URL（格式／体积），跳过视觉预跑' }
  }

  const ticketHint =
    options.ticketId === undefined ? '本工单' : `bug 平台工单 #${options.ticketId}`
  const body = {
    model,
    stream: false,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              `请观察以下与${ticketHint}相关的前端截图／附件。`,
              '用中文客观描述：页面结构、可见控件与文案、异常表现（错位、空白、错误提示、枚举不对等）、与修复相关的线索。',
              '区分事实与猜测；不要编造看不到的接口或代码路径。',
              '控制在 400 字以内，可分条。',
            ].join(''),
          },
          ...imageParts,
        ],
      },
    ],
  }

  let response: Response
  try {
    response = await fetchImpl(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `视觉预跑网络失败: ${message}` }
  }

  if (!response.ok) {
    let detail = ''
    try {
      detail = (await response.text()).slice(0, 400)
    } catch {
      // ignore body read failures
    }
    return {
      ok: false,
      error: `视觉预跑 HTTP ${response.status}${detail.length > 0 ? `: ${detail}` : ''}`,
    }
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `视觉预跑响应非 JSON: ${message}` }
  }

  const text = extractAssistantText(payload)
  if (text === null || text.trim().length === 0) {
    return { ok: false, error: '视觉预跑未返回可用文本' }
  }
  return { ok: true, text: text.trim(), usedPaths }
}

/**
 * @param payload - chat.completions JSON body.
 * @returns assistant message text, or null when missing.
 */
function extractAssistantText(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const first = choices[0]
  if (first === null || typeof first !== 'object' || Array.isArray(first)) return null
  const message = (first as { message?: unknown }).message
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return null
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content
  return null
}
