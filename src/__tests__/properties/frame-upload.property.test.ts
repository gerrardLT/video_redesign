/**
 * Feature: parsing-pipeline-gemini-rollback, Property 2: Frame upload correctness and failure isolation
 *
 * For any set of frame files with mixed upload success/failure outcomes:
 * 1. The resulting URL list contains only successfully uploaded URLs (no nulls in the filtered list)
 * 2. Failed frames don't block subsequent uploads (all frames are attempted)
 * 3. The filtered success list is in ascending index order
 * 4. If all fail, an error is thrown
 *
 * **Validates: Requirements 3.1, 3.2, 3.3**
 */
import fc from 'fast-check'
import { describe, it, expect } from 'vitest'

/**
 * Simulate the upload logic from parse-video.ts as a pure function for testing.
 *
 * This mirrors the frame upload behavior in the Worker:
 * - Takes an array of frame paths and a mock upload function
 * - Returns an array of URLs (string | null)
 * - On individual frame upload failure: logs, sets null, continues
 * - If ALL frames fail: throws an error
 */
async function uploadFramesWithIsolation(
  framePaths: string[],
  uploadFn: (ossKey: string, framePath: string) => Promise<string>
): Promise<{ urls: (string | null)[]; successUrls: string[] }> {
  const urls: (string | null)[] = []

  for (let i = 0; i < framePaths.length; i++) {
    const framePath = framePaths[i]
    const ossKey = `frames/test-project/frame_${i}.jpg`
    try {
      const url = await uploadFn(ossKey, framePath)
      urls.push(url)
    } catch {
      urls.push(null)
    }
  }

  const successUrls = urls.filter((url): url is string => url !== null)
  if (successUrls.length === 0 && framePaths.length > 0) {
    throw new Error(`所有帧上传 OSS 失败（共 ${framePaths.length} 帧），无法继续解析`)
  }

  return { urls, successUrls }
}

/**
 * Arbitrary: generates an array of frame paths (1-20 frames)
 */
const framePathsArb = fc.array(
  fc.nat({ max: 99 }).map((i) => `/tmp/frames/frame_${i}.jpg`),
  { minLength: 1, maxLength: 20 }
)

/**
 * Arbitrary: generates a success/failure pattern (boolean array matching frame count)
 * true = upload succeeds, false = upload fails
 */
function successPatternArb(length: number) {
  return fc.array(fc.boolean(), { minLength: length, maxLength: length })
}

/**
 * Create a mock upload function based on a success pattern.
 * Tracks which indices were actually called.
 */
function createMockUploadFn(pattern: boolean[], calledIndices: number[]) {
  let callIndex = 0
  return async (ossKey: string, _framePath: string): Promise<string> => {
    const idx = callIndex++
    calledIndices.push(idx)
    if (pattern[idx]) {
      return `https://oss.example.com/${ossKey}`
    }
    throw new Error(`Upload failed for frame ${idx}`)
  }
}

describe('Property 2: Frame upload correctness and failure isolation', () => {
  it('resulting URL list contains only successfully uploaded URLs (no nulls in filtered list)', async () => {
    await fc.assert(
      fc.asyncProperty(
        framePathsArb.chain((paths) =>
          successPatternArb(paths.length).map((pattern) => ({ paths, pattern }))
        ),
        async ({ paths, pattern }) => {
          // At least one success to avoid the "all fail" error case
          const hasAnySuccess = pattern.some((s) => s)
          if (!hasAnySuccess) return // skip this case, tested separately

          const calledIndices: number[] = []
          const uploadFn = createMockUploadFn(pattern, calledIndices)

          const result = await uploadFramesWithIsolation(paths, uploadFn)

          // successUrls should contain no nulls
          for (const url of result.successUrls) {
            expect(url).not.toBeNull()
            expect(typeof url).toBe('string')
            expect(url.length).toBeGreaterThan(0)
          }

          // successUrls count should match number of true values in pattern
          const expectedSuccessCount = pattern.filter((s) => s).length
          expect(result.successUrls.length).toBe(expectedSuccessCount)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('failed frames do not block subsequent uploads (all frames are attempted)', async () => {
    await fc.assert(
      fc.asyncProperty(
        framePathsArb.chain((paths) =>
          successPatternArb(paths.length).map((pattern) => ({ paths, pattern }))
        ),
        async ({ paths, pattern }) => {
          const hasAnySuccess = pattern.some((s) => s)
          if (!hasAnySuccess) return // skip all-fail case

          const calledIndices: number[] = []
          const uploadFn = createMockUploadFn(pattern, calledIndices)

          await uploadFramesWithIsolation(paths, uploadFn)

          // Every frame should have been attempted regardless of failures
          expect(calledIndices.length).toBe(paths.length)
          // Indices should be sequential 0..N-1
          for (let i = 0; i < paths.length; i++) {
            expect(calledIndices[i]).toBe(i)
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('filtered success list is in ascending index order', async () => {
    await fc.assert(
      fc.asyncProperty(
        framePathsArb.chain((paths) =>
          successPatternArb(paths.length).map((pattern) => ({ paths, pattern }))
        ),
        async ({ paths, pattern }) => {
          const hasAnySuccess = pattern.some((s) => s)
          if (!hasAnySuccess) return

          const calledIndices: number[] = []
          const uploadFn = createMockUploadFn(pattern, calledIndices)

          const result = await uploadFramesWithIsolation(paths, uploadFn)

          // Each successUrl should contain a frame_{index} with strictly ascending indices
          const indices: number[] = []
          for (const url of result.successUrls) {
            const match = url.match(/frame_(\d+)\.jpg/)
            expect(match).not.toBeNull()
            indices.push(Number(match![1]))
          }

          // Verify ascending order
          for (let i = 1; i < indices.length; i++) {
            expect(indices[i]).toBeGreaterThan(indices[i - 1])
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('throws an error if all frames fail', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 20 }),
        async (frameCount) => {
          const paths = Array.from({ length: frameCount }, (_, i) => `/tmp/frames/frame_${i}.jpg`)
          // All false — every upload fails
          const pattern = Array.from({ length: frameCount }, () => false)

          const calledIndices: number[] = []
          const uploadFn = createMockUploadFn(pattern, calledIndices)

          await expect(
            uploadFramesWithIsolation(paths, uploadFn)
          ).rejects.toThrow(/所有帧上传 OSS 失败/)

          // All frames should still have been attempted before throwing
          expect(calledIndices.length).toBe(frameCount)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('urls array has same length as input framePaths with null for failed frames', async () => {
    await fc.assert(
      fc.asyncProperty(
        framePathsArb.chain((paths) =>
          successPatternArb(paths.length).map((pattern) => ({ paths, pattern }))
        ),
        async ({ paths, pattern }) => {
          const hasAnySuccess = pattern.some((s) => s)
          if (!hasAnySuccess) return

          const calledIndices: number[] = []
          const uploadFn = createMockUploadFn(pattern, calledIndices)

          const result = await uploadFramesWithIsolation(paths, uploadFn)

          // urls array should be same length as input
          expect(result.urls.length).toBe(paths.length)

          // Each url should be string (success) or null (failure) matching pattern
          for (let i = 0; i < paths.length; i++) {
            if (pattern[i]) {
              expect(result.urls[i]).not.toBeNull()
              expect(typeof result.urls[i]).toBe('string')
            } else {
              expect(result.urls[i]).toBeNull()
            }
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('each successful frame OSS key matches the pattern frames/{projectId}/frame_{index}.jpg', async () => {
    await fc.assert(
      fc.asyncProperty(
        framePathsArb.chain((paths) =>
          successPatternArb(paths.length).map((pattern) => ({ paths, pattern }))
        ),
        async ({ paths, pattern }) => {
          const hasAnySuccess = pattern.some((s) => s)
          if (!hasAnySuccess) return

          const calledIndices: number[] = []
          const uploadFn = createMockUploadFn(pattern, calledIndices)

          const result = await uploadFramesWithIsolation(paths, uploadFn)

          // Verify each success URL matches the OSS path pattern
          const ossPattern = /^https:\/\/oss\.example\.com\/frames\/test-project\/frame_\d+\.jpg$/
          for (const url of result.successUrls) {
            expect(url).toMatch(ossPattern)
          }
        }
      ),
      { numRuns: 100 }
    )
  })
})
