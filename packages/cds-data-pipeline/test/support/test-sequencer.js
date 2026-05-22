/**
 * Run messaging-heavy integration last so earlier suites cannot leave scheduled
 * ticks or a torn-down provider interfering with event-execute polls.
 */
const Sequencer = require('@jest/test-sequencer').default

class PipelineTestSequencer extends Sequencer {
    sort(tests) {
        const copy = Array.from(tests)
        const rank = (p) => {
            if (p.includes('event-execute.test.js')) return 2
            if (p.includes('/unit/')) return 1
            return 0
        }
        return copy.sort((a, b) => {
            const ra = rank(a.path)
            const rb = rank(b.path)
            if (ra !== rb) return ra - rb
            return a.path.localeCompare(b.path)
        })
    }
}

module.exports = PipelineTestSequencer
