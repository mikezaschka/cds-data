class UnsupportedCqnPredicateError extends Error {
    constructor(message) {
        super(message)
        this.name = 'UnsupportedCqnPredicateError'
    }
}

function isKeyword(token, keyword) {
    return typeof token === 'string' && token.toLowerCase() === keyword
}

function numericValue(value) {
    if (typeof value === 'number') return Number.isNaN(value) ? null : value
    if (typeof value !== 'string' || value.trim() === '') return null
    const parsed = Number(value)
    return Number.isNaN(parsed) ? null : parsed
}

function equalValues(left, right) {
    if (left === right) return true
    const leftNumber = numericValue(left)
    const rightNumber = numericValue(right)
    return leftNumber !== null && rightNumber !== null && leftNumber === rightNumber
}

function compareValues(left, operator, right) {
    switch (operator) {
    case '=':
    case '==':
        return equalValues(left, right)
    case '!=':
    case '<>':
        return !equalValues(left, right)
    case '>':
        return left > right
    case '>=':
        return left >= right
    case '<':
        return left < right
    case '<=':
        return left <= right
    default:
        throw new UnsupportedCqnPredicateError(`Unsupported CQN predicate operator: ${String(operator)}`)
    }
}

function refValue(ref, row) {
    return ref.reduce((value, segment) => {
        if (value == null) return value
        const name = typeof segment === 'string' ? segment : segment?.id
        if (!name) {
            throw new UnsupportedCqnPredicateError('Unsupported CQN reference segment')
        }
        return value[name]
    }, row)
}

function evaluateFunction(token, row) {
    const name = String(token.func || '').toLowerCase()
    const args = (token.args || []).map(arg => evaluateOperand(arg, row))
    switch (name) {
    case 'contains':
        return String(args[0] ?? '').includes(String(args[1] ?? ''))
    case 'startswith':
        return String(args[0] ?? '').startsWith(String(args[1] ?? ''))
    case 'endswith':
        return String(args[0] ?? '').endsWith(String(args[1] ?? ''))
    case 'tolower':
    case 'lower':
        return String(args[0] ?? '').toLowerCase()
    case 'toupper':
    case 'upper':
        return String(args[0] ?? '').toUpperCase()
    case 'trim':
        return String(args[0] ?? '').trim()
    case 'length':
        return String(args[0] ?? '').length
    case 'concat':
        return args.map(value => String(value ?? '')).join('')
    default:
        throw new UnsupportedCqnPredicateError(`Unsupported CQN predicate function: ${name || '<missing>'}`)
    }
}

function evaluateOperand(token, row) {
    if (token == null || typeof token !== 'object') return token
    if (Object.prototype.hasOwnProperty.call(token, 'val')) return token.val
    if (Array.isArray(token.ref)) return refValue(token.ref, row)
    if (Array.isArray(token.list)) return token.list.map(item => evaluateOperand(item, row))
    if (token.func) return evaluateFunction(token, row)
    if (Array.isArray(token.xpr)) return evaluateWhere(token.xpr, row)
    throw new UnsupportedCqnPredicateError('Unsupported CQN predicate operand')
}

function evaluateList(token, row) {
    if (Array.isArray(token?.list)) {
        return token.list.map(item => evaluateOperand(item, row))
    }
    // The CDS compiler represents a single-value IN list as `{ xpr: [{ val }] }`.
    if (Array.isArray(token?.xpr)) {
        const values = []
        for (const item of token.xpr) {
            if (item === ',') continue
            values.push(evaluateOperand(item, row))
        }
        return values
    }
    throw new UnsupportedCqnPredicateError('IN predicate requires a CQN list')
}

function likeRegex(pattern, escapeCharacter) {
    let source = '^'
    let escaped = false
    for (const char of String(pattern)) {
        if (!escaped && escapeCharacter && char === escapeCharacter) {
            escaped = true
            continue
        }
        if (!escaped && char === '%') source += '.*'
        else if (!escaped && char === '_') source += '.'
        else source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        escaped = false
    }
    if (escaped) source += String(escapeCharacter).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`${source}$`, 's')
}

class PredicateParser {
    constructor(tokens, row) {
        this.tokens = tokens
        this.row = row
        this.index = 0
    }

    parse() {
        const result = this.parseOr()
        if (this.index !== this.tokens.length) {
            throw new UnsupportedCqnPredicateError(
                `Unsupported CQN predicate near token ${this.index}: ${String(this.tokens[this.index])}`
            )
        }
        return Boolean(result)
    }

    parseOr() {
        let result = this.parseAnd()
        while (isKeyword(this.tokens[this.index], 'or')) {
            this.index += 1
            const right = this.parseAnd()
            result = result || right
        }
        return result
    }

    parseAnd() {
        let result = this.parseNot()
        while (isKeyword(this.tokens[this.index], 'and')) {
            this.index += 1
            const right = this.parseNot()
            result = result && right
        }
        return result
    }

    parseNot() {
        if (isKeyword(this.tokens[this.index], 'not')) {
            this.index += 1
            return !this.parseNot()
        }
        return this.parsePredicate()
    }

    parsePredicate() {
        const token = this.tokens[this.index]
        if (token?.xpr && Array.isArray(token.xpr)) {
            this.index += 1
            return evaluateWhere(token.xpr, this.row)
        }
        if (token === '(') {
            this.index += 1
            const result = this.parseOr()
            if (this.tokens[this.index] !== ')') {
                throw new UnsupportedCqnPredicateError('Unclosed CQN predicate group')
            }
            this.index += 1
            return result
        }

        const left = evaluateOperand(this.tokens[this.index++], this.row)
        let negated = false
        if (isKeyword(this.tokens[this.index], 'not')) {
            negated = true
            this.index += 1
        }

        const operatorToken = this.tokens[this.index]
        if (operatorToken == null || operatorToken === ')' || isKeyword(operatorToken, 'and') || isKeyword(operatorToken, 'or')) {
            if (negated) throw new UnsupportedCqnPredicateError('Incomplete CQN predicate after NOT')
            return Boolean(left)
        }

        const operator = String(operatorToken).toLowerCase()
        this.index += 1
        let result
        if (operator === 'between') {
            const lower = evaluateOperand(this.tokens[this.index++], this.row)
            if (!isKeyword(this.tokens[this.index], 'and')) {
                throw new UnsupportedCqnPredicateError('BETWEEN predicate is missing AND')
            }
            this.index += 1
            const upper = evaluateOperand(this.tokens[this.index++], this.row)
            result = left >= lower && left <= upper
        } else if (operator === 'in') {
            const values = evaluateList(this.tokens[this.index++], this.row)
            result = values.some(value => equalValues(left, value))
        } else if (operator === 'like') {
            const pattern = evaluateOperand(this.tokens[this.index++], this.row)
            let escapeCharacter
            if (isKeyword(this.tokens[this.index], 'escape')) {
                this.index += 1
                escapeCharacter = evaluateOperand(this.tokens[this.index++], this.row)
            }
            result = left != null && likeRegex(pattern, escapeCharacter).test(String(left))
        } else if (operator === 'is') {
            let isNot = false
            if (isKeyword(this.tokens[this.index], 'not')) {
                isNot = true
                this.index += 1
            }
            result = equalValues(left, evaluateOperand(this.tokens[this.index++], this.row))
            if (isNot) result = !result
        } else {
            result = compareValues(left, operator, evaluateOperand(this.tokens[this.index++], this.row))
        }
        return negated ? !result : result
    }
}

function evaluateWhere(where, row) {
    if (!Array.isArray(where) || where.length === 0) return true
    return new PredicateParser(where, row).parse()
}

function compareOrderValues(left, right) {
    if (equalValues(left, right)) return 0
    if (left == null) return -1
    if (right == null) return 1
    const leftNumber = numericValue(left)
    const rightNumber = numericValue(right)
    if (leftNumber !== null && rightNumber !== null) {
        return leftNumber < rightNumber ? -1 : 1
    }
    return left < right ? -1 : 1
}

function applyExpandedSemantics(records, where, orderBy) {
    let result = Array.isArray(records) ? [...records] : []
    if (Array.isArray(where) && where.length > 0) {
        result = result.filter(record => evaluateWhere(where, record))
    }
    if (Array.isArray(orderBy) && orderBy.length > 0) {
        result = result
            .map((record, index) => ({ record, index }))
            .sort((left, right) => {
                for (const order of orderBy) {
                    const comparison = compareOrderValues(
                        evaluateOperand(order, left.record),
                        evaluateOperand(order, right.record),
                    )
                    if (comparison !== 0) {
                        return String(order.sort).toLowerCase() === 'desc' ? -comparison : comparison
                    }
                }
                return left.index - right.index
            })
            .map(item => item.record)
    }
    return result
}

module.exports = {
    applyExpandedSemantics,
    evaluateWhere,
    UnsupportedCqnPredicateError,
}
