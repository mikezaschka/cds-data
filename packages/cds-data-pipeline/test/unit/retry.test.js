const { withRetry } = require('../../srv/lib/retry')

describe('withRetry', () => {
    it('retries on transient errors and succeeds', async () => {
        let attempts = 0
        const result = await withRetry(
            () => {
                attempts++
                if (attempts < 3) throw new Error('Transient error')
                return 'success'
            },
            { maxRetries: 3, baseDelay: 10 },
        )
        expect(result).toBe('success')
        expect(attempts).toBe(3)
    })

    it('does not retry when retryOn returns false', async () => {
        let attempts = 0
        await expect(
            withRetry(
                () => {
                    attempts++
                    const err = new Error('Not Found')
                    err.status = 404
                    throw err
                },
                {
                    maxRetries: 3,
                    baseDelay: 10,
                    retryOn: (err) => !err.status || err.status >= 500,
                },
            ),
        ).rejects.toThrow('Not Found')
        expect(attempts).toBe(1)
    })

    it('throws after max retries exhausted', async () => {
        let attempts = 0
        await expect(
            withRetry(
                () => {
                    attempts++
                    throw new Error('Always fails')
                },
                { maxRetries: 2, baseDelay: 10 },
            ),
        ).rejects.toThrow('Always fails')
        expect(attempts).toBe(3)
    })
})
