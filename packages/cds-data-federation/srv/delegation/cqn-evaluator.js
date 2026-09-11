class UnsupportedCqnPredicateError extends Error {
    constructor(message) {
        super(message)
        this.name = 'UnsupportedCqnPredicateError'
    }
}

function isKeyword(token, keyword) {
    return typeof token === 'string' && token.toLowerCase() === keyword
}

const NUMERIC_TYPES = new Set([
    'cds.Decimal',
    'cds.DecimalFloat',
    'cds.Double',
    'cds.Integer',
    'cds.Integer64',
    'cds.UInt8',
    'cds.Int16',
    'cds.Int32',
    'cds.Int64',
])

function decimalParts(value) {
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return null
        if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
            throw new UnsupportedCqnPredicateError(
                'Unsafe numeric CQN value; represent Int64 and Decimal values as strings'
            )
        }
    } else if (typeof value !== 'string' || value.trim() === '') {
        return null
    }

    const match = String(value).trim().match(/^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/)
    if (!match) return null

    const negative = match[1] === '-'
    const fraction = match[3] || ''
    const exponent = Number(match[4] || 0)
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 10000) {
        throw new UnsupportedCqnPredicateError('Numeric CQN exponent is outside the supported range')
    }
    let digits = `${match[2]}${fraction}`.replace(/^0+/, '') || '0'
    if (digits.length + Math.abs(exponent) > 10000) {
        throw new UnsupportedCqnPredicateError('Numeric CQN value is outside the supported range')
    }
    if (digits === '0') return { coefficient: 0n, scale: 0 }
    let scale = fraction.length - exponent
    if (scale < 0) {
        digits += '0'.repeat(-scale)
        scale = 0
    }
    while (scale > 0 && digits.endsWith('0')) {
        digits = digits.slice(0, -1)
        scale -= 1
    }
    const coefficient = BigInt(digits) * (negative && digits !== '0' ? -1n : 1n)
    return { coefficient, scale }
}

function compareDecimals(left, right) {
    const leftParts = decimalParts(left)
    const rightParts = decimalParts(right)
    if (!leftParts || !rightParts) return null
    const scale = Math.max(leftParts.scale, rightParts.scale)
    const leftCoefficient = leftParts.coefficient * (10n ** BigInt(scale - leftParts.scale))
    const rightCoefficient = rightParts.coefficient * (10n ** BigInt(scale - rightParts.scale))
    if (leftCoefficient === rightCoefficient) return 0
    return leftCoefficient < rightCoefficient ? -1 : 1
}

function operandType(token, entityDef) {
    const name = token?.ref?.[0]
    return typeof name === 'string' ? entityDef?.elements?.[name]?.type : null
}

function compareScalarValues(left, right, type) {
    if (NUMERIC_TYPES.has(type)) {
        const comparison = compareDecimals(left, right)
        if (comparison !== null) return comparison
    }
    if (left === right) return 0
    if (left == null) return -1
    if (right == null) return 1
    return left < right ? -1 : 1
}

function equalValues(left, right, type) {
    if (left === right) return true
    return NUMERIC_TYPES.has(type) && compareDecimals(left, right) === 0
}

function compareValues(left, operator, right, type) {
    const isOrderedComparison = operator === '>' || operator === '>=' || operator === '<' || operator === '<='
    if (isOrderedComparison && (left == null || right == null)) return null

    switch (operator) {
    case '=':
    case '==':
        return equalValues(left, right, type)
    case '!=':
    case '<>':
        return !equalValues(left, right, type)
    case '>':
        return compareScalarValues(left, right, type) > 0
    case '>=':
        return compareScalarValues(left, right, type) >= 0
    case '<':
        return compareScalarValues(left, right, type) < 0
    case '<=':
        return compareScalarValues(left, right, type) <= 0
    default:
        throw new UnsupportedCqnPredicateError(`Unsupported CQN predicate operator: ${String(operator)}`)
    }
}

function triNot(value) {
    return value == null ? null : !value
}

function triAnd(left, right) {
    if (left === false || right === false) return false
    if (left == null || right == null) return null
    return Boolean(left && right)
}

function triOr(left, right) {
    if (left === true || right === true) return true
    if (left == null || right == null) return null
    return Boolean(left || right)
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

function evaluateFunction(token, row, entityDef) {
    const name = String(token.func || '').toLowerCase()
    const args = (token.args || []).map(arg => evaluateOperand(arg, row, entityDef))
    switch (name) {
    case 'contains':
        return args[0] == null || args[1] == null
            ? null
            : String(args[0]).includes(String(args[1]))
    case 'startswith':
        return args[0] == null || args[1] == null
            ? null
            : String(args[0]).startsWith(String(args[1]))
    case 'endswith':
        return args[0] == null || args[1] == null
            ? null
            : String(args[0]).endsWith(String(args[1]))
    case 'tolower':
    case 'lower':
        return args[0] == null ? null : String(args[0]).toLowerCase()
    case 'toupper':
    case 'upper':
        return args[0] == null ? null : String(args[0]).toUpperCase()
    case 'trim':
        return args[0] == null ? null : String(args[0]).trim()
    case 'length':
        return args[0] == null ? null : String(args[0]).length
    case 'concat':
        if (args.every(value => value == null)) return null
        return args.filter(value => value != null).map(String).join('')
    default:
        throw new UnsupportedCqnPredicateError(`Unsupported CQN predicate function: ${name || '<missing>'}`)
    }
}

function evaluateOperand(token, row, entityDef) {
    if (token == null || typeof token !== 'object') return token
    if (Object.prototype.hasOwnProperty.call(token, 'val')) return token.val
    if (Array.isArray(token.ref)) return refValue(token.ref, row)
    if (Array.isArray(token.list)) return token.list.map(item => evaluateOperand(item, row, entityDef))
    if (token.func) return evaluateFunction(token, row, entityDef)
    if (Array.isArray(token.xpr)) return evaluatePredicate(token.xpr, row, entityDef)
    throw new UnsupportedCqnPredicateError('Unsupported CQN predicate operand')
}

function evaluateList(token, row, entityDef) {
    if (Array.isArray(token?.list)) {
        return token.list.map(item => evaluateOperand(item, row, entityDef))
    }
    // The CDS compiler represents a single-value IN list as `{ xpr: [{ val }] }`.
    if (Array.isArray(token?.xpr)) {
        const values = []
        for (const item of token.xpr) {
            if (item === ',') continue
            values.push(evaluateOperand(item, row, entityDef))
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
    constructor(tokens, row, entityDef) {
        this.tokens = tokens
        this.row = row
        this.entityDef = entityDef
        this.index = 0
    }

    parse() {
        return this.parseValue() === true
    }

    parseValue() {
        const result = this.parseOr()
        if (this.index !== this.tokens.length) {
            throw new UnsupportedCqnPredicateError(
                `Unsupported CQN predicate near token ${this.index}: ${String(this.tokens[this.index])}`
            )
        }
        return result
    }

    parseOr() {
        let result = this.parseAnd()
        while (isKeyword(this.tokens[this.index], 'or')) {
            this.index += 1
            const right = this.parseAnd()
            result = triOr(result, right)
        }
        return result
    }

    parseAnd() {
        let result = this.parseNot()
        while (isKeyword(this.tokens[this.index], 'and')) {
            this.index += 1
            const right = this.parseNot()
            result = triAnd(result, right)
        }
        return result
    }

    parseNot() {
        if (isKeyword(this.tokens[this.index], 'not')) {
            this.index += 1
            return triNot(this.parseNot())
        }
        return this.parsePredicate()
    }

    parsePredicate() {
        const token = this.tokens[this.index]
        if (token?.xpr && Array.isArray(token.xpr)) {
            this.index += 1
            return evaluatePredicate(token.xpr, this.row, this.entityDef)
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

        const leftToken = this.tokens[this.index++]
        const left = evaluateOperand(leftToken, this.row, this.entityDef)
        let negated = false
        if (isKeyword(this.tokens[this.index], 'not')) {
            negated = true
            this.index += 1
        }

        const operatorToken = this.tokens[this.index]
        if (operatorToken == null || operatorToken === ')' || isKeyword(operatorToken, 'and') || isKeyword(operatorToken, 'or')) {
            if (negated) throw new UnsupportedCqnPredicateError('Incomplete CQN predicate after NOT')
            return left == null ? null : Boolean(left)
        }

        const operator = String(operatorToken).toLowerCase()
        this.index += 1
        let result
        if (operator === 'between') {
            const lowerToken = this.tokens[this.index++]
            const lower = evaluateOperand(lowerToken, this.row, this.entityDef)
            if (!isKeyword(this.tokens[this.index], 'and')) {
                throw new UnsupportedCqnPredicateError('BETWEEN predicate is missing AND')
            }
            this.index += 1
            const upperToken = this.tokens[this.index++]
            const upper = evaluateOperand(upperToken, this.row, this.entityDef)
            const type = operandType(leftToken, this.entityDef)
                || operandType(lowerToken, this.entityDef)
                || operandType(upperToken, this.entityDef)
            result = triAnd(
                compareValues(left, '>=', lower, type),
                compareValues(left, '<=', upper, type),
            )
        } else if (operator === 'in') {
            const listToken = this.tokens[this.index++]
            const values = evaluateList(listToken, this.row, this.entityDef)
            const type = operandType(leftToken, this.entityDef)
            result = left == null ? null : values.some(value => equalValues(left, value, type))
        } else if (operator === 'like') {
            const pattern = evaluateOperand(this.tokens[this.index++], this.row, this.entityDef)
            let escapeCharacter
            if (isKeyword(this.tokens[this.index], 'escape')) {
                this.index += 1
                escapeCharacter = evaluateOperand(this.tokens[this.index++], this.row, this.entityDef)
            }
            result = left == null || pattern == null
                ? null
                : likeRegex(pattern, escapeCharacter).test(String(left))
        } else if (operator === 'is') {
            let isNot = false
            if (isKeyword(this.tokens[this.index], 'not')) {
                isNot = true
                this.index += 1
            }
            const rightToken = this.tokens[this.index++]
            const type = operandType(leftToken, this.entityDef) || operandType(rightToken, this.entityDef)
            result = equalValues(
                left,
                evaluateOperand(rightToken, this.row, this.entityDef),
                type,
            )
            if (isNot) result = !result
        } else {
            const rightToken = this.tokens[this.index++]
            const type = operandType(leftToken, this.entityDef) || operandType(rightToken, this.entityDef)
            result = compareValues(
                left,
                operator,
                evaluateOperand(rightToken, this.row, this.entityDef),
                type,
            )
        }
        return negated ? triNot(result) : result
    }
}

function evaluatePredicate(where, row, entityDef) {
    return new PredicateParser(where, row, entityDef).parseValue()
}

function evaluateWhere(where, row, entityDef) {
    if (!Array.isArray(where) || where.length === 0) return true
    return new PredicateParser(where, row, entityDef).parse()
}

function scalarOrderOperand(order) {
    if (!Array.isArray(order?.xpr)) return order
    if (order.xpr.length === 1) return scalarOrderOperand(order.xpr[0])
    throw new UnsupportedCqnPredicateError('Unsupported CQN scalar order expression')
}

function applyExpandedSemantics(records, where, orderBy, limit, entityDef) {
    let result = Array.isArray(records) ? [...records] : []
    if (Array.isArray(where) && where.length > 0) {
        result = result.filter(record => evaluateWhere(where, record, entityDef))
    }
    if (Array.isArray(orderBy) && orderBy.length > 0) {
        result = result
            .map((record, index) => ({ record, index }))
            .sort((left, right) => {
                for (const order of orderBy) {
                    const operand = scalarOrderOperand(order)
                    const comparison = compareScalarValues(
                        evaluateOperand(operand, left.record, entityDef),
                        evaluateOperand(operand, right.record, entityDef),
                        operandType(operand, entityDef),
                    )
                    if (comparison !== 0) {
                        return String(order.sort).toLowerCase() === 'desc' ? -comparison : comparison
                    }
                }
                return left.index - right.index
            })
            .map(item => item.record)
    }
    if (limit) {
        const offset = Number(limit.offset?.val || 0)
        const rows = limit.rows?.val == null ? undefined : Number(limit.rows.val)
        if (!Number.isSafeInteger(offset) || offset < 0 || (rows !== undefined && (!Number.isSafeInteger(rows) || rows < 0))) {
            throw new UnsupportedCqnPredicateError('Invalid CQN expand limit')
        }
        result = result.slice(offset, rows === undefined ? undefined : offset + rows)
    }
    return result
}

module.exports = {
    applyExpandedSemantics,
    evaluateWhere,
    UnsupportedCqnPredicateError,
}
