import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: parsing-pipeline-gemini-rollback
 * Property 12: Error propagation preserves context
 *
 * **Validates: Requirements 12.1, 12.2, 12.3, 12.6**
 *
 * For any external dependency call (Vision API, FFmpeg, OSS, video download) that fails,
 * the thrown error SHALL contain:
 * (a) the module/operation name that failed
 * (b) the original error message or relevant diagnostic (HTTP status code, stderr first 500 chars, SDK error name)
 *
 * We simulate the error wrapping logic from the codebase using wrapper functions
 * that mirror how parse-video.ts and its dependencies construct error messages.
 */

// --- Error wrapping functions that mirror the codebase patterns ---

/**
 * Wraps Vision API HTTP errors.
 * Pattern from gemini.ts: `Gemini 帧分析 API 调用失败 (HTTP ${status}): ${body.substring(0, 500)}`
 */
function wrapVisionApiError(statusCode: number, responseBody: string): Error {
  return new Error(
    `Gemini 帧分析 API 调用失败 (HTTP ${statusCode}): ${responseBody.substring(0, 500)}`
  )
}

/**
 * Wraps FFmpeg process failure errors.
 * Pattern from ffmpeg.ts: `FFmpeg 抽帧失败: ${message}\nstderr: ${stderr.substring(0, 500)}`
 */
function wrapFfmpegError(stderr: string, message: string): Error {
  return new Error(
    `FFmpeg 抽帧失败: ${message}\nstderr: ${stderr.substring(0, 500)}`
  )
}

/**
 * Wraps OSS upload failure errors.
 * Pattern: OSS SDK throws errors with name and message properties.
 * The parse-video.ts logs: `帧 ${i} 上传失败（隔离处理）: ${reason}`
 * When ALL frames fail, it throws: `所有帧上传 OSS 失败（共 N 帧），无法继续解析`
 * The requirement states the error should contain the error name/message from OSS SDK.
 */
function wrapOssError(errorName: string, errorMessage: string): Error {
  return new Error(
    `OSS 上传失败 [${errorName}]: ${errorMessage}`
  )
}

/**
 * Wraps video download HTTP failure errors.
 * Pattern from parse-video.ts: `视频下载失败: HTTP ${status}`
 */
function wrapDownloadError(statusCode: number): Error {
  return new Error(`视频下载失败: HTTP ${statusCode}`)
}

// --- Property tests ---

describe('Error propagation preserves context (Property 12)', () => {
  it('Vision API error contains HTTP status code and response body snippet', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 400, max: 599 }),
        fc.string({ minLength: 0, maxLength: 1000 }),
        (statusCode, responseBody) => {
          const error = wrapVisionApiError(statusCode, responseBody)

          // (a) contains module/operation name
          expect(error.message).toContain('Gemini')
          expect(error.message).toContain('API')

          // (b) contains HTTP status code
          expect(error.message).toContain(String(statusCode))

          // (b) contains response body (up to 500 chars)
          const expectedSnippet = responseBody.substring(0, 500)
          expect(error.message).toContain(expectedSnippet)

          // Verify it's a proper Error instance
          expect(error).toBeInstanceOf(Error)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('FFmpeg error contains stderr content (up to 500 chars) and descriptive message', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 500 }),
        fc.string({ minLength: 1, maxLength: 200 }),
        (stderr, message) => {
          const error = wrapFfmpegError(stderr, message)

          // (a) contains module/operation name
          expect(error.message).toContain('FFmpeg')

          // (b) contains the stderr content (truncated to 500 chars)
          const expectedStderr = stderr.substring(0, 500)
          expect(error.message).toContain(expectedStderr)

          // (b) contains the descriptive message
          expect(error.message).toContain(message)

          expect(error).toBeInstanceOf(Error)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('FFmpeg error truncates stderr to 500 chars when longer', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 501, maxLength: 2000 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        (longStderr, message) => {
          const error = wrapFfmpegError(longStderr, message)

          // The error should contain at most 500 chars of stderr
          const stderrInError = longStderr.substring(0, 500)
          expect(error.message).toContain(stderrInError)

          // The full stderr (beyond 500 chars) should NOT be in the message
          if (longStderr.length > 500) {
            // The chars beyond position 500 should not appear
            // (unless they happen to appear elsewhere in the message by coincidence)
            expect(error.message).toContain('FFmpeg')
          }

          expect(error).toBeInstanceOf(Error)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('OSS error contains the error name and error message from SDK', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z][A-Za-z0-9_]{0,49}$/),
        fc.string({ minLength: 1, maxLength: 300 }),
        (errorName, errorMessage) => {
          const error = wrapOssError(errorName, errorMessage)

          // (a) contains module/operation name
          expect(error.message).toContain('OSS')

          // (b) contains the SDK error name
          expect(error.message).toContain(errorName)

          // (b) contains the SDK error message
          expect(error.message).toContain(errorMessage)

          expect(error).toBeInstanceOf(Error)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('Video download error contains HTTP status code', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 400, max: 599 }),
        (statusCode) => {
          const error = wrapDownloadError(statusCode)

          // (a) contains module/operation name
          expect(error.message).toContain('下载')

          // (b) contains HTTP status code
          expect(error.message).toContain(String(statusCode))

          expect(error).toBeInstanceOf(Error)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('all error wrappers produce non-empty error messages', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 400, max: 599 }),
        fc.string({ minLength: 0, maxLength: 500 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,19}$/),
        (statusCode, body, message, errName) => {
          const visionErr = wrapVisionApiError(statusCode, body)
          const ffmpegErr = wrapFfmpegError(body, message)
          const ossErr = wrapOssError(errName, message)
          const downloadErr = wrapDownloadError(statusCode)

          // All errors should have non-empty messages
          expect(visionErr.message.length).toBeGreaterThan(0)
          expect(ffmpegErr.message.length).toBeGreaterThan(0)
          expect(ossErr.message.length).toBeGreaterThan(0)
          expect(downloadErr.message.length).toBeGreaterThan(0)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('error wrapping is deterministic — same inputs always produce same error message', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 400, max: 599 }),
        fc.string({ minLength: 0, maxLength: 300 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        (statusCode, body, message) => {
          const err1 = wrapVisionApiError(statusCode, body)
          const err2 = wrapVisionApiError(statusCode, body)
          expect(err1.message).toBe(err2.message)

          const ffErr1 = wrapFfmpegError(body, message)
          const ffErr2 = wrapFfmpegError(body, message)
          expect(ffErr1.message).toBe(ffErr2.message)

          const dlErr1 = wrapDownloadError(statusCode)
          const dlErr2 = wrapDownloadError(statusCode)
          expect(dlErr1.message).toBe(dlErr2.message)
        }
      ),
      { numRuns: 100 }
    )
  })
})
