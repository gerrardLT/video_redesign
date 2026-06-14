/**
 * Feature: parsing-pipeline-gemini-rollback, Property 6: SQLite retry semantics
 *
 * For any async operation wrapped in withRetry:
 * (a) if it fails with "SQLITE_BUSY" or "database is locked", it retries up to 3 times
 *     with delays 500ms, 1000ms, 1500ms;
 * (b) if it fails with any other error, it throws immediately without retry;
 * (c) if all 4 attempts fail with lock errors, the original error is thrown;
 * (d) if operation succeeds on any attempt (1st through 4th), the result is returned.
 *
 * **Validates: Requirements 8.1, 8.2, 8.3**
 */
import fc from 'fast-check'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { withRetry, _internals, RETRY_CONFIG } from '@/lib/db-retry'

/**
 * Arbitrary: generates a random SQLite lock error message
 */
const lockErrorMessageArb = fc.oneof(
  fc.constant('SQLITE_BUSY'),
  fc.constant('database is locked'),
  fc.constant('SQLITE_BUSY (database is locked)'),
  fc.constant('Error: SQLITE_BUSY - database is locked'),
  fc.constant('SQLITE_BUSY: cannot start a transaction within a transaction')
)

/**
 * Arbitrary: generates a non-lock error message (does not contain SQLITE_BUSY or database is locked)
 */
const nonLockErrorMessageArb = fc.constantFrom(
  'Connection refused',
  'Timeout exceeded',
  'ENOENT: no such file',
  'Permission denied',
  'Invalid argument',
  'Network error',
  'Out of memory',
  'SQLITE_CONSTRAINT: UNIQUE constraint failed',
  'SQLITE_ERROR: no such table',
  'Foreign key constraint failed'
)

describe('Property 6: SQLite retry semantics', () => {
  let originalSleep: typeof _internals.sleep
  let sleepCalls: number[]

  beforeEach(() => {
    originalSleep = _internals.sleep
    sleepCalls = []
    // Inject zero-delay sleep that records calls
    _internals.sleep = async (ms: number) => {
      sleepCalls.push(ms)
    }
  })

  afterEach(() => {
    _internals.sleep = originalSleep
  })

  it('retries up to 3 times with delays 500ms, 1000ms, 1500ms on lock errors', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }),
        lockErrorMessageArb,
        async (retryCount, errorMsg) => {
          sleepCalls = []
          let callCount = 0

          // Fails with lock error for `retryCount` times, then succeeds
          const operation = async () => {
            callCount++
            if (callCount <= retryCount) {
              throw new Error(errorMsg)
            }
            return 'success'
          }

          const result = await withRetry(operation)
          expect(result).toBe('success')
          expect(callCount).toBe(retryCount + 1)

          // Verify delay values match expected pattern
          const expectedDelays = RETRY_CONFIG.delays.slice(0, retryCount)
          expect(sleepCalls).toEqual(expectedDelays)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('throws immediately without retry on non-lock errors', async () => {
    await fc.assert(
      fc.asyncProperty(nonLockErrorMessageArb, async (errorMsg) => {
        sleepCalls = []
        let callCount = 0

        const operation = async () => {
          callCount++
          throw new Error(errorMsg)
        }

        await expect(withRetry(operation)).rejects.toThrow(errorMsg)
        expect(callCount).toBe(1)
        expect(sleepCalls).toHaveLength(0)
      }),
      { numRuns: 100 }
    )
  })

  it('throws the original error after all 4 attempts fail with lock errors', async () => {
    await fc.assert(
      fc.asyncProperty(lockErrorMessageArb, async (errorMsg) => {
        sleepCalls = []
        let callCount = 0
        const originalError = new Error(errorMsg)

        const operation = async () => {
          callCount++
          throw originalError
        }

        await expect(withRetry(operation)).rejects.toThrow(originalError)
        expect(callCount).toBe(4) // 1 initial + 3 retries
        expect(sleepCalls).toEqual([500, 1000, 1500])
      }),
      { numRuns: 100 }
    )
  })

  it('returns the result on any successful attempt (1st through 4th)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 3 }),
        lockErrorMessageArb,
        fc.oneof(fc.integer(), fc.string({ minLength: 1 }), fc.constant(null), fc.constant(true)),
        async (failuresBeforeSuccess, errorMsg, returnValue) => {
          sleepCalls = []
          let callCount = 0

          const operation = async () => {
            callCount++
            if (callCount <= failuresBeforeSuccess) {
              throw new Error(errorMsg)
            }
            return returnValue
          }

          const result = await withRetry(operation)
          expect(result).toBe(returnValue)
          expect(callCount).toBe(failuresBeforeSuccess + 1)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('distinguishes lock errors from non-lock errors in mixed failure sequences', async () => {
    await fc.assert(
      fc.asyncProperty(
        nonLockErrorMessageArb,
        fc.integer({ min: 0, max: 3 }),
        lockErrorMessageArb,
        async (nonLockMsg, lockFailuresBefore, lockMsg) => {
          sleepCalls = []
          let callCount = 0

          // First `lockFailuresBefore` attempts fail with lock error,
          // then one attempt fails with non-lock error — should throw immediately
          const operation = async () => {
            callCount++
            if (callCount <= lockFailuresBefore) {
              throw new Error(lockMsg)
            }
            throw new Error(nonLockMsg)
          }

          await expect(withRetry(operation)).rejects.toThrow(nonLockMsg)
          expect(callCount).toBe(lockFailuresBefore + 1)
          // Should have slept for each lock error retry
          expect(sleepCalls).toHaveLength(lockFailuresBefore)
        }
      ),
      { numRuns: 100 }
    )
  })
})
