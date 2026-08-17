import { describe, expect, it } from 'vitest'
import { parseSingleRange, planContentResponse } from '../../src/server/range.js'

describe('single byte ranges', () => {
  it('plans a full response without a Range header', () => {
    expect(planContentResponse(undefined, 10)).toEqual({
      status: 200,
      start: 0,
      end: 9,
      length: 10,
    })
  })

  it('supports bounded, open-ended, and suffix ranges', () => {
    expect(parseSingleRange('bytes=2-5', 10)).toEqual({ kind: 'partial', start: 2, end: 5, length: 4 })
    expect(parseSingleRange('bytes=7-', 10)).toEqual({ kind: 'partial', start: 7, end: 9, length: 3 })
    expect(parseSingleRange('bytes=-3', 10)).toEqual({ kind: 'partial', start: 7, end: 9, length: 3 })
  })

  it('returns 416 for multiple, malformed, and out-of-bounds ranges', () => {
    expect(planContentResponse('bytes=0-1,4-5', 10)).toMatchObject({ status: 416, contentRange: 'bytes */10' })
    expect(planContentResponse('items=0-1', 10)).toMatchObject({ status: 416 })
    expect(planContentResponse('bytes=10-', 10)).toMatchObject({ status: 416 })
    expect(planContentResponse('bytes=0-0', 0)).toMatchObject({ status: 416, contentRange: 'bytes */0' })
  })
})
