const cds = require('@sap/cds')
const path = require('path')
const { scanAnnotations } = require('../../srv/annotation-scanner')

describe('annotation-scanner', () => {
    const { expect } = cds.test(path.join(__dirname, '../fixtures/consumer'))

    it('[M-2] discovers @materialize.snapshot and compiles query', () => {
        const { configs } = scanAnnotations(cds.model)
        expect(configs).to.have.length(1)
        expect(configs[0].entityName).to.equal('DailyCustomerRevenue')
        expect(configs[0].sourceService).to.equal('db')
        expect(configs[0].compiledQuery).to.be.a('function')
        const built = configs[0].compiledQuery()
        expect(built.SELECT.groupBy).to.exist
        expect(built.SELECT.from.ref.join('.')).to.equal('consumer.SourceOrders')
    })

    it('[M-5] rejects @federation on same entity', () => {
        const model = cds.compile(`
          namespace x;
          entity O { key ID : String; }
          @materialize.snapshot: { source: { service: 'db' } }
          @federation.delegate
          entity Bad as projection on O { key ID } group by ID;
        `)
        expect(() => scanAnnotations(model)).to.throw(/cannot combine/)
    })
})
