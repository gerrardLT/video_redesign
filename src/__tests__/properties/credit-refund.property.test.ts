/**
 * Feature: parsing-pipeline-gemini-rollback, Property 11: Credit refund on insufficient balance
 *
 * For any multi-segment generation request where the user's balance becomes insufficient
 * partway through segment creation, all previously frozen credits from this request
 * SHALL be refunded (balance restored) and an error returned.
 *
 * **Validates: Requirements 9.10**
 */
import fc from 'fast-check'
import { describe, it, expect } from 'vitest'

// ========================
// Pure simulation of the credit freeze/refund logic
// from src/app/api/projects/[id]/generate/route.ts
// ========================

interface RefundSimulation {
  initialBalance: number
  segmentCosts: number[]
}

interface RefundResult {
  failed: boolean
  failedAtSegment: number | null
  totalRefunded: number
  finalBalance: number
}

/**
 * Simulates the generation route's credit freeze logic:
 * - Iterates through segments, each with a cost
 * - For each segment, checks if current balance >= cost
 * - If balance insufficient at segment K:
 *   - Refunds all credits frozen in segments 0..K-1
 *   - Returns error state with finalBalance = initialBalance
 * - If all segments succeed, finalBalance = initialBalance - sum(costs)
 */
function simulateGenerationWithRefund(sim: RefundSimulation): RefundResult {
  let currentBalance = sim.initialBalance
  const frozenAmounts: number[] = []

  for (let i = 0; i < sim.segmentCosts.length; i++) {
    const cost = sim.segmentCosts[i]

    if (currentBalance < cost) {
      // Insufficient balance at segment i — refund all previously frozen
      const totalRefunded = frozenAmounts.reduce((sum, a) => sum + a, 0)
      const restoredBalance = currentBalance + totalRefunded

      return {
        failed: true,
        failedAtSegment: i,
        totalRefunded,
        finalBalance: restoredBalance,
      }
    }

    // Freeze credits for this segment
    currentBalance -= cost
    frozenAmounts.push(cost)
  }

  // All segments succeeded — no refund needed
  return {
    failed: false,
    failedAtSegment: null,
    totalRefunded: 0,
    finalBalance: currentBalance,
  }
}

// ========================
// Generators
// ========================

/**
 * Generator for a simulation where balance becomes insufficient partway through.
 * Strategy: generate initialBalance and segmentCosts such that cumulative cost
 * exceeds initialBalance at some segment K (1 ≤ K < N).
 */
const insufficientBalanceArb = fc
  .record({
    initialBalance: fc.integer({ min: 1, max: 1000 }),
    segmentCosts: fc.array(fc.integer({ min: 1, max: 100 }), {
      minLength: 2,
      maxLength: 20,
    }),
  })
  .filter((sim) => {
    // Ensure the first segment CAN be afforded (so we have at least 1 frozen)
    if (sim.segmentCosts[0] > sim.initialBalance) return false

    // Ensure total cost exceeds balance (so failure happens at some point)
    const totalCost = sim.segmentCosts.reduce((sum, c) => sum + c, 0)
    return totalCost > sim.initialBalance
  })

/**
 * Generator for a simulation where balance is sufficient for ALL segments.
 */
const sufficientBalanceArb = fc
  .record({
    initialBalance: fc.integer({ min: 100, max: 1000 }),
    segmentCosts: fc.array(fc.integer({ min: 1, max: 10 }), {
      minLength: 1,
      maxLength: 10,
    }),
  })
  .filter((sim) => {
    const totalCost = sim.segmentCosts.reduce((sum, c) => sum + c, 0)
    return totalCost <= sim.initialBalance
  })

/**
 * General generator — any valid simulation scenario.
 */
const anySimulationArb = fc.record({
  initialBalance: fc.integer({ min: 1, max: 1000 }),
  segmentCosts: fc.array(fc.integer({ min: 1, max: 100 }), {
    minLength: 1,
    maxLength: 20,
  }),
})

// ========================
// Property tests
// ========================

describe('Property 11: Credit refund on insufficient balance', () => {
  it('when balance is insufficient partway, all frozen credits are refunded and balance is restored to initial', () => {
    fc.assert(
      fc.property(insufficientBalanceArb, (sim) => {
        const result = simulateGenerationWithRefund(sim)

        // Must fail
        expect(result.failed).toBe(true)
        expect(result.failedAtSegment).not.toBeNull()

        // Final balance must equal initial balance (all frozen credits refunded)
        expect(result.finalBalance).toBe(sim.initialBalance)

        // Total refunded must equal sum of costs for segments 0..K-1
        const frozenSegments = sim.segmentCosts.slice(0, result.failedAtSegment!)
        const expectedRefund = frozenSegments.reduce((sum, c) => sum + c, 0)
        expect(result.totalRefunded).toBe(expectedRefund)
      }),
      { numRuns: 200 }
    )
  })

  it('failure point K is the first segment where cumulative cost exceeds balance', () => {
    fc.assert(
      fc.property(insufficientBalanceArb, (sim) => {
        const result = simulateGenerationWithRefund(sim)

        expect(result.failed).toBe(true)
        const K = result.failedAtSegment!

        // Segments 0..K-1 should all be affordable cumulatively
        let remaining = sim.initialBalance
        for (let i = 0; i < K; i++) {
          expect(remaining).toBeGreaterThanOrEqual(sim.segmentCosts[i])
          remaining -= sim.segmentCosts[i]
        }

        // Segment K should NOT be affordable
        expect(remaining).toBeLessThan(sim.segmentCosts[K])
      }),
      { numRuns: 200 }
    )
  })

  it('when balance is sufficient for all segments, no refund occurs', () => {
    fc.assert(
      fc.property(sufficientBalanceArb, (sim) => {
        const result = simulateGenerationWithRefund(sim)

        // Should not fail
        expect(result.failed).toBe(false)
        expect(result.failedAtSegment).toBeNull()
        expect(result.totalRefunded).toBe(0)

        // Final balance = initial - total cost
        const totalCost = sim.segmentCosts.reduce((sum, c) => sum + c, 0)
        expect(result.finalBalance).toBe(sim.initialBalance - totalCost)
      }),
      { numRuns: 100 }
    )
  })

  it('net effect on balance is always 0 when refund occurs (balance conservation)', () => {
    fc.assert(
      fc.property(anySimulationArb, (sim) => {
        const result = simulateGenerationWithRefund(sim)

        if (result.failed) {
          // On failure: balance must be fully restored
          expect(result.finalBalance).toBe(sim.initialBalance)
        } else {
          // On success: balance is reduced by total cost
          const totalCost = sim.segmentCosts.reduce((sum, c) => sum + c, 0)
          expect(result.finalBalance).toBe(sim.initialBalance - totalCost)
        }
      }),
      { numRuns: 200 }
    )
  })

  it('refund amount equals sum of all successfully frozen segments', () => {
    fc.assert(
      fc.property(anySimulationArb, (sim) => {
        const result = simulateGenerationWithRefund(sim)

        if (result.failed && result.failedAtSegment! > 0) {
          // Refund = sum of costs for segments that were successfully frozen
          const frozenCosts = sim.segmentCosts.slice(0, result.failedAtSegment!)
          const expectedRefund = frozenCosts.reduce((sum, c) => sum + c, 0)
          expect(result.totalRefunded).toBe(expectedRefund)
        } else if (result.failed && result.failedAtSegment === 0) {
          // Failed at first segment: nothing was frozen, nothing to refund
          expect(result.totalRefunded).toBe(0)
        } else {
          // Success: no refund
          expect(result.totalRefunded).toBe(0)
        }
      }),
      { numRuns: 200 }
    )
  })
})
