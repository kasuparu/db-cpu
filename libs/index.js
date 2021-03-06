'use strict';

function InputStream(input) {
    let pos = 0, line = 1, col = 0;
    return {
        next: next,
        peek: peek,
        eof: eof,
        croak: croak,
    };
    function next() {
        const ch = input.charAt(pos++);
        if (ch === '\n') {
            line++;
            col = 0;
        } else col++;
        return ch;
    }

    function peek() {
        return input.charAt(pos);
    }

    function eof() {
        return peek() === '';
    }

    function croak(msg) {
        throw new Error(msg + ' (' + line + ':' + col + ')');
    }
}

function TokenStream(input) {
    let current = null;
    const keywords = ' if then else function λ true false zero inc loop ';
    return {
        next: next,
        peek: peek,
        eof: eof,
        croak: input.croak
    };
    function is_keyword(x) {
        return keywords.indexOf(' ' + x + ' ') >= 0;
    }

    function is_digit(ch) {
        return /[0-9]/i.test(ch);
    }

    function is_id_start(ch) {
        return /[a-zλ_]/i.test(ch);
    }

    function is_id(ch) {
        return is_id_start(ch) || '?!-<>=0123456789'.indexOf(ch) >= 0;
    }

    function is_op_char(ch) {
        return '+-*/%=&|<>!'.indexOf(ch) >= 0;
    }

    function is_punc(ch) {
        return ',;(){}[]'.indexOf(ch) >= 0;
    }

    function is_whitespace(ch) {
        return ' \t\n'.indexOf(ch) >= 0;
    }

    function read_while(predicate) {
        let str = '';
        while (!input.eof() && predicate(input.peek()))
            str += input.next();
        return str;
    }

    function read_number() {
        let has_dot = false;
        const number = read_while(function (ch) {
            if (ch === '.') {
                if (has_dot) return false;
                has_dot = true;
                return true;
            }
            return is_digit(ch);
        });
        return {type: 'num', value: parseFloat(number)};
    }

    function read_ident() {
        const id = read_while(is_id);
        return {
            type: is_keyword(id) ? 'kw' : 'var',
            value: id
        };
    }

    function read_escaped(end) {
        let escaped = false, str = '';
        input.next();
        while (!input.eof()) {
            const ch = input.next();
            if (escaped) {
                str += ch;
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === end) {
                break;
            } else {
                str += ch;
            }
        }
        return str;
    }

    function read_string() {
        return {type: 'str', value: read_escaped('"')};
    }

    function skip_comment() {
        read_while(function (ch) {
            return ch !== '\n'
        });
        input.next();
    }

    function read_next() {
        read_while(is_whitespace);
        if (input.eof()) return null;
        const ch = input.peek();
        if (ch === '#') {
            skip_comment();
            return read_next();
        }
        if (ch === '"') return read_string();
        if (is_digit(ch)) return read_number();
        if (is_id_start(ch)) return read_ident();
        if (is_punc(ch)) return {
            type: 'punc',
            value: input.next()
        };
        if (is_op_char(ch)) return {
            type: 'op',
            value: read_while(is_op_char)
        };
        input.croak('Can\'t handle character: ' + ch);
    }

    function peek() {
        return current || (current = read_next());
    }

    function next() {
        let tok = current;
        current = null;
        return tok || read_next();
    }

    function eof() {
        return peek() === null;
    }
}

function parse(input) {
    const PRECEDENCE = {
        '=': 1,
        '||': 2,
        '&&': 3,
        '<': 7, '>': 7, '<=': 7, '>=': 7, '==': 7, '!=': 7,
        '+': 10, '-': 10,
        '*': 20, '/': 20, '%': 20,
    };
    const FALSE = {type: 'bool', value: false};
    return parse_toplevel();
    function is_punc(ch) {
        const tok = input.peek();
        return tok && tok.type === 'punc' && (!ch || tok.value === ch) && tok;
    }

    function is_kw(kw) {
        const tok = input.peek();
        return tok && tok.type === 'kw' && (!kw || tok.value === kw) && tok;
    }

    function is_op(op) {
        const tok = input.peek();
        return tok && tok.type === 'op' && (!op || tok.value === op) && tok;
    }

    function skip_punc(ch) {
        if (is_punc(ch)) input.next();
        else input.croak('Expecting punctuation: \"' + ch + '\"');
    }

    function skip_kw(kw) {
        if (is_kw(kw)) input.next();
        else input.croak('Expecting keyword: \"' + kw + '\"');
    }

    function skip_op(op) {
        if (is_op(op)) input.next();
        else input.croak('Expecting operator: \"' + op + '\"');
    }

    function unexpected() {
        input.croak('Unexpected token: ' + JSON.stringify(input.peek()));
    }

    function maybe_binary(left, my_prec) {
        const tok = is_op();
        if (tok) {
            const his_prec = PRECEDENCE[tok.value];
            if (his_prec > my_prec) {
                input.next();
                return maybe_binary({
                    type: tok.value === '=' ? 'assign' : 'binary',
                    operator: tok.value,
                    left: left,
                    right: maybe_binary(parse_atom(), his_prec)
                }, my_prec);
            }
        }
        return left;
    }

    function delimited(start, stop, separator, parser) {
        const a = [];
        let first = true;
        skip_punc(start);
        while (!input.eof()) {
            if (is_punc(stop)) break;
            if (first) first = false; else skip_punc(separator);
            if (is_punc(stop)) break;
            a.push(parser());
        }
        skip_punc(stop);
        return a;
    }

    function parse_call(func) {
        return {
            type: 'call',
            func: func,
            args: delimited('(', ')', ',', parse_expression),
        };
    }

    function parse_varname() {
        const name = input.next();
        if (name.type !== 'var') input.croak('Expecting variable name');
        return name.value;
    }

    function parse_if() {
        skip_kw('if');
        const cond = parse_expression();
        if (!is_punc('{')) skip_kw('then');
        const then = parse_expression();
        const ret = {
            type: 'if',
            cond: cond,
            then: then,
        };
        if (is_kw('else')) {
            input.next();
            ret.else = parse_expression();
        }
        return ret;
    }

    function parse_function() {
        return {
            type: 'assign',
            operator: '=',
            left: input.next(),
            right: {
                type: 'function',
                vars: delimited('(', ')', ',', parse_varname),
                body: parse_expression()
            }
        };
    }

    function parse_zero() {
        return {
            type: 'zero',
            vars: delimited('(', ')', ',', parse_varname)
        };
    }

    function parse_inc() {
        return {
            type: 'inc',
            vars: delimited('(', ')', ',', parse_varname)
        };
    }

    function parse_loop() {
        skip_kw('loop');
        const max = parse_expression();
        const body = parse_expression();
        return {
            type: 'loop',
            max: max,
            body: body
        };
    }

    function parse_bool() {
        return {
            type: 'bool',
            value: input.next().value === 'true'
        };
    }

    function maybe_call(expr) {
        expr = expr();
        return is_punc('(') ? parse_call(expr) : expr;
    }

    function parse_atom() {
        return maybe_call(function () {
            if (is_punc('(')) {
                input.next();
                const exp = parse_expression();
                skip_punc(')');
                return exp;
            }
            if (is_punc('{')) return parse_prog();
            if (is_kw('if')) return parse_if();
            if (is_kw('true') || is_kw('false')) return parse_bool();
            if (is_kw('function')) {
                input.next();
                return parse_function();
            }
            if (is_kw('zero')) {
                input.next();
                return parse_zero();
            }
            if (is_kw('inc')) {
                input.next();
                return parse_inc();
            }
            if (is_kw('loop')) {
                return parse_loop();
            }
            const tok = input.next();
            if (tok.type === 'var' || tok.type === 'num' || tok.type === 'str')
                return tok;
            unexpected();
        });
    }

    function parse_toplevel() {
        const prog = [];
        while (!input.eof()) {
            prog.push(parse_expression());
            if (!input.eof()) skip_punc(';');
        }
        return {type: 'prog', prog: prog};
    }

    function parse_prog() {
        const prog = delimited('{', '}', ';', parse_expression);
        if (prog.length === 0) return FALSE;
        if (prog.length === 1) return prog[0];
        return {type: 'prog', prog: prog};
    }

    function parse_expression() {
        return maybe_call(function () {
            return maybe_binary(parse_atom(), 0);
        });
    }
}

function Environment(parent) {
    this.id = globalEnvId++;
    this.vars = Object.create(null);
    this.parent = parent;
    console.log(`created env${this.id} ${JSON.stringify(this)}`);
}
Environment.prototype = {
    extend: function () {
        return new Environment(this);
    },
    lookup: function (name) {
        let scope = this;
        while (scope) {
            if (Object.prototype.hasOwnProperty.call(scope.vars, name))
                return scope;
            scope = scope.parent;
        }
    },
    get: function (name) {
        const scope = this.lookup(name);
        if (scope && name in scope.vars) {
            console.log(
                `env${this.id} get `,
                name,
                'function' !== typeof scope.vars[name] ? scope.vars[name] : 'function',
                `found in env${scope.id}`
            );
            return scope.vars[name];
        }
        throw new Error('Undefined variable ' + name);
    },
    set: function (name, value) {
        const scope = this.lookup(name);
        if (!scope && this.parent)
            throw new Error('Undefined variable ' + name);
        console.log(`env${this.id} set `, name, 'function' !== typeof value ? value : 'function');
        return (scope || this).vars[name] = value;
    },
    def: function (name, value) {
        console.log(`env${this.id} def `, name, 'function' !== typeof value ? value : 'function');
        return this.vars[name] = value;
    }
};

function evaluate(exp, env) {
    let result = false;
    switch (exp.type) {
        case 'num':
        case 'str':
        case 'bool':
            return exp.value;

        case 'var':
            return env.get(exp.value);

        case 'assign':
            if (exp.left.type !== 'var')
                throw new Error('Cannot assign to ' + JSON.stringify(exp.left));
            return env.set(exp.left.value, evaluate(exp.right, env));

        case 'zero':
            for (let i = 0; i < exp.vars.length; ++i)
                env.set(exp.vars[i], 0);
            return 0;

        case 'inc':
            for (let i = 0; i < exp.vars.length; ++i)
                result = env.set(exp.vars[i], env.get(exp.vars[i]) + 1);
            return result;

        case 'binary':
            return apply_op(exp.operator,
                evaluate(exp.left, env),
                evaluate(exp.right, env));

        case 'function':
            return make_function(env, exp);

        case 'if':
            const cond = evaluate(exp.cond, env);
            if (cond !== false) return evaluate(exp.then, env);
            return exp.else ? evaluate(exp.else, env) : false;

        case 'loop':
            const max = evaluate(exp.max, env);
            if ('number' !== typeof max)
                throw new Error('Cannot loop to ' + JSON.stringify(exp.max));
            for (let i = 0; i < max; ++i)
                result = evaluate(exp.body, env);
            return result;

        case 'prog':
            let val = false;
            exp.prog.forEach(function (exp) {
                val = evaluate(exp, env)
            });
            return val;

        case 'call':
            const func = evaluate(exp.func, env);
            return func.apply(null, exp.args.map(function (arg) {
                return evaluate(arg, env);
            }));

        default:
            throw new Error('I don\'t know how to evaluate ' + exp.type);
    }
}

function apply_op(op, a, b) {
    function num(x) {
        if (typeof x !== 'number')
            throw new Error('Expected number but got ' + x);
        return x;
    }

    function div(x) {
        if (num(x) === 0)
            throw new Error('Divide by zero');
        return x;
    }

    switch (op) {
        case '+':
            return num(a) + num(b);
        case '-':
            return num(a) - num(b);
        case '*':
            return num(a) * num(b);
        case '/':
            return num(a) / div(b);
        case '%':
            return num(a) % div(b);
        case '&&':
            return a !== false && b;
        case '||':
            return a !== false ? a : b;
        case '<':
            return num(a) < num(b);
        case '>':
            return num(a) > num(b);
        case '<=':
            return num(a) <= num(b);
        case '>=':
            return num(a) >= num(b);
        case '==':
            return a === b;
        case '!=':
            return a !== b;
    }
    throw new Error('Can\'t apply operator ' + op);
}

function make_function(env, exp) {
    function lambda() {
        const names = exp.vars;
        const scope = env.extend();
        for (let i = 0; i < names.length; ++i)
            scope.def(names[i], i < arguments.length ? arguments[i] : false);
        console.log(`lambda scope ${JSON.stringify(scope)}`);
        return evaluate(exp.body, scope);
    }

    return lambda;
}

/* -----[ entry point for NodeJS ]----- */
let globalEnvId = 0;
const globalEnv = new Environment();

globalEnv.def('time', function (func) {
    try {
        console.time('time');
        return func();
    } finally {
        console.timeEnd('time');
    }
});

if (typeof process !== 'undefined') (function () {
    const util = require('util');
    globalEnv.def('println', function (val) {
        console.log(val);
    });
    globalEnv.def('print', function (val) {
        util.print(val); // TODO
    });
    let code = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('readable', function () {
        const chunk = process.stdin.read();
        if (chunk) code += chunk;
    });
    process.stdin.on('end', function () {
        const ast = parse(TokenStream(InputStream(code)));
        evaluate(ast, globalEnv);
    });
})();
