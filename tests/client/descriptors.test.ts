import { describe, expect, it } from 'vitest'
import { buildDescriptors } from '../../src/client/descriptors.js'

describe('client Typert descriptors', () => {
  it('provides schema factories for every client invocation codec', () => {
    for (const invocation of buildDescriptors()) {
      const codecs = [...invocation.parameters.map((parameter) => parameter.codec), invocation.result]
      for (const codec of codecs) {
        const create = codec.create
        expect(typeof create).toBe('function')
        expect(() => create!().parse(undefined)).toThrow()
      }
    }
  })
})
