"""A bounded four-operator numeric parser; no eval, names, calls or attributes."""
import ast
import math
import re


def evaluate_number(value):
    if isinstance(value, bool):
        raise ValueError('booleans are not numeric inputs')
    if not isinstance(value, str):
        result = float(value)
        if not math.isfinite(result):
            raise ValueError('result must be finite')
        return result
    text = value.strip().removeprefix('=').replace('×', '*').replace('÷', '/').replace('−', '-')
    if not text or len(text) > 4096 or not re.fullmatch(r'[\d.eE+\-*/()\s]+', text):
        raise ValueError('only numbers, parentheses and + - * / are supported')
    # Python rejects decimal literals such as 01; the input grammar accepts them.
    text = re.sub(r'(?<![\w.])0+(?=\d)', '', text)
    try:
        tree = ast.parse(text.strip(), mode='eval')
    except (SyntaxError, RecursionError):
        raise ValueError('incomplete numeric expression') from None
    count = 0

    def visit(node, depth=0):
        nonlocal count
        count += 1
        if depth > 64 or count > 256:
            raise ValueError('numeric expression is too complex')
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            result = float(node.value)
        elif isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            result = visit(node.operand, depth + 1) * (-1 if isinstance(node.op, ast.USub) else 1)
        elif isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div)):
            left, right = visit(node.left, depth + 1), visit(node.right, depth + 1)
            if isinstance(node.op, ast.Add): result = left + right
            elif isinstance(node.op, ast.Sub): result = left - right
            elif isinstance(node.op, ast.Mult): result = left * right
            elif right == 0: raise ValueError('division by zero')
            else: result = left / right
        else:
            raise ValueError('only numbers, parentheses and + - * / are supported')
        if not math.isfinite(result):
            raise ValueError('result must be finite')
        return result
    return visit(tree.body)
