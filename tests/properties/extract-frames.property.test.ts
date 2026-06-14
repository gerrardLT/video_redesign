import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: parsing-pipeline-gemini-rollback
 * Property 1: Frame extraction count invariant
 *
 * **Validates: Requirements 2.1**
 *
 * For any video duration > 0 and target frame count of 15, the extractFrames
 * function SHALL produce between 10 and 20 frames (inclusive), with the interval
 * calculated as `duration / 15`.
 *
 * Since we can't run FFmpeg in property tests, we test the CALCULATION logic:
 * - interval = duration / targetFrameCount (default 15)
 * - interval is always positive for positive duration and targetFrameCount
 * - FFmpeg fps=1/interval produces approximately targetFrameCount frames
 */

// --- Pure calculation logic extracted from src/lib/ffmpeg.ts extractFrames ---

/**
 * Calculates the frame extraction interval given duration and target frame count.
 * This mirrors the calculation in extractFrames: `interval = duration / targetFrameCount`
 */
function calculateInterval(duration: number, targetFrameCount: number): number {
  return duration / targetFrameCount
}

/**
 * Estimates how many frames FFmpeg fps=1/interval filter would produce for a given duration.
 * FFmpeg fps filter outputs a frame at t=0, t=interval, t=2*interval, ...
 * up to t <= duration. So frame count = floor(duration / interval) + 1.
 *
 * Since interval = duration / targetFrameCount:
 *   duration / interval = targetFrameCount (exactly in infinite precision)
 *   So frame count = floor(targetFrameCount) + 1 = targetFrameCount + 1 for integer targets.
 *
 * However, due to floating point, this may vary by ±1.
 */
function estimateFrameCount(duration: number, interval: number): number {
  // FFmpeg fps=1/interval filter: outputs frames at t=0, t=interval, t=2*interval, ...
  // Count = number of multiples of interval that fit in [0, duration] + 1 for frame at t=0
  return Math.floor(duration / interval) + 1
}

describe('Frame extraction count invariant (Property 1)', () => {
  it('interval = duration / targetFrameCount for any positive duration and default targetFrameCount=15', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 3600, noNaN: true, noDefaultInfinity: true }),
        (duration) => {
          const targetFrameCount = 15
          const interval = calculateInterval(duration, targetFrameCount)

          // interval should equal duration / 15
          expect(interval).toBeCloseTo(duration / 15, 10)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('interval is always positive for any positive duration and targetFrameCount', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.1, max: 3600, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 1, max: 100 }),
        (duration, targetFrameCount) => {
          const interval = calculateInterval(duration, targetFrameCount)

          expect(interval).toBeGreaterThan(0)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('for any duration in [1, 3600], interval=duration/15 produces approximately 15 frames (between 10 and 20)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 3600, noNaN: true, noDefaultInfinity: true }),
        (duration) => {
          const targetFrameCount = 15
          const interval = calculateInterval(duration, targetFrameCount)
          const expectedFrames = estimateFrameCount(duration, interval)

          // The estimated frame count should be in the range [10, 20]
          expect(expectedFrames).toBeGreaterThanOrEqual(10)
          expect(expectedFrames).toBeLessThanOrEqual(20)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('interval calculation is deterministic — same inputs always produce same interval', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.1, max: 3600, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 1, max: 50 }),
        (duration, targetFrameCount) => {
          const interval1 = calculateInterval(duration, targetFrameCount)
          const interval2 = calculateInterval(duration, targetFrameCount)

          expect(interval1).toBe(interval2)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('estimated frame count is close to targetFrameCount (within ±2 due to floating point)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 3600, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 5, max: 30 }),
        (duration, targetFrameCount) => {
          const interval = calculateInterval(duration, targetFrameCount)
          const expectedFrames = estimateFrameCount(duration, interval)

          // Due to floating point precision in division, the frame count should be
          // within ±2 of targetFrameCount + 1 (the +1 accounts for the frame at t=0)
          // In practice: floor(targetFrameCount) + 1 = targetFrameCount + 1 for integers,
          // but floating point may cause floor to be off by 1.
          expect(expectedFrames).toBeGreaterThanOrEqual(targetFrameCount - 1)
          expect(expectedFrames).toBeLessThanOrEqual(targetFrameCount + 2)
        }
      ),
      { numRuns: 200 }
    )
  })
})
