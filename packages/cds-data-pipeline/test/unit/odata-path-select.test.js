import { describe, expect, it } from 'vitest'
import {
    PIPELINES_LIST_SELECT,
    PIPELINE_DETAIL_SELECT,
    PIPELINE_RUNS_EXPAND,
    PIPELINE_RUNS_LIST_SELECT,
} from '../../app/pipeline-console-src/webapp/util/ODataPath.ts'

describe('Pipeline Console OData $select', () => {
    it('includes lastSync on list and detail selects', () => {
        expect(PIPELINES_LIST_SELECT).toContain('lastSync')
        expect(PIPELINE_DETAIL_SELECT).toContain('lastSync')
    })

    it('includes run timestamps in expand select', () => {
        expect(PIPELINE_RUNS_EXPAND).toContain('startTime')
        expect(PIPELINE_RUNS_EXPAND).toContain('endTime')
        expect(PIPELINE_RUNS_LIST_SELECT).toContain('startTime')
        expect(PIPELINE_RUNS_LIST_SELECT).toContain('endTime')
    })
})
