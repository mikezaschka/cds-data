const { isTransientDbError, withTransientDbRetry } = require('../../srv/lib/transientDbError')

describe('isTransientDbError', () => {
    it('retries HANA code 1034', () => {
        const err = new Error('exceed maximum number of external connections: 2500 (HANA 1034)')
        err.code = 1034
        expect(isTransientDbError(err)).toBe(true)
    })

    it('retries string code 1034', () => {
        const err = new Error('connection limit')
        err.code = '1034'
        expect(isTransientDbError(err)).toBe(true)
    })

    it('retries HANA 1034 from message alone', () => {
        const err = new Error('exceed maximum number of external connections: 2500 (HANA 1034)')
        expect(isTransientDbError(err)).toBe(true)
    })

    it('retries SQLITE_BUSY', () => {
        const err = new Error('database is locked')
        err.code = 'SQLITE_BUSY'
        expect(isTransientDbError(err)).toBe(true)
    })

    it('retries SQLITE_LOCKED', () => {
        const err = new Error('database table is locked')
        err.code = 'SQLITE_LOCKED'
        expect(isTransientDbError(err)).toBe(true)
    })

    it('retries ECONNRESET / ETIMEDOUT / ECONNREFUSED', () => {
        for (const code of ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED']) {
            const err = new Error(code)
            err.code = code
            expect(isTransientDbError(err)).toBe(true)
        }
    })

    it('retries pool acquire timeout messages', () => {
        const err = new Error('ResourceRequest timed out — acquireTimeoutMillis')
        expect(isTransientDbError(err)).toBe(true)
    })

    it('retries nested cause with HANA 1034', () => {
        const cause = new Error('exceed maximum number of external connections: 2500')
        cause.code = 1034
        const err = new Error('Failed to add pipeline X')
        err.cause = cause
        expect(isTransientDbError(err)).toBe(true)
    })

    it('does not retry validation / already-exists style errors', () => {
        expect(isTransientDbError(new Error("Pipeline configuration 'X' already exists"))).toBe(false)
        expect(isTransientDbError(new Error("addPipeline: source.query requires …"))).toBe(false)
    })

    it('does not retry HTTP 4xx', () => {
        const err = new Error('Not Found')
        err.status = 404
        expect(isTransientDbError(err)).toBe(false)
    })
})

describe('withTransientDbRetry', () => {
    it('[4.10.1] retries HANA 1034 once then succeeds', async () => {
        let attempts = 0
        const result = await withTransientDbRetry(
            () => {
                attempts++
                if (attempts === 1) {
                    const err = new Error('exceed maximum number of external connections: 2500 (HANA 1034)')
                    err.code = 1034
                    throw err
                }
                return 'ok'
            },
            { baseDelay: 1 },
        )
        expect(result).toBe('ok')
        expect(attempts).toBe(2)
    })

    it('does not retry permanent registration errors', async () => {
        let attempts = 0
        await expect(
            withTransientDbRetry(
                () => {
                    attempts++
                    throw new Error("Pipeline configuration 'X' already exists")
                },
                { baseDelay: 1, maxRetries: 3 },
            ),
        ).rejects.toThrow("already exists")
        expect(attempts).toBe(1)
    })

    it('throws after max retries exhausted on persistent 1034', async () => {
        let attempts = 0
        await expect(
            withTransientDbRetry(
                () => {
                    attempts++
                    const err = new Error('exceed maximum number of external connections: 2500 (HANA 1034)')
                    err.code = 1034
                    throw err
                },
                { maxRetries: 2, baseDelay: 1 },
            ),
        ).rejects.toThrow(/1034|external connections/)
        expect(attempts).toBe(3)
    })
})
