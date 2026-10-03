import unittest
from elisa_calculator.arithmetic import evaluate_number
from elisa_calculator.core.coordinates import finite_number, normalize_options, coordinate_options
from elisa_calculator.io.readers import read_table_from_raw_text
class ArithmeticTests(unittest.TestCase):
    def test_operator_precedence_and_literals(self):
        for value, expected in [('=1/20', .05), ('=(2+3)*4-6/2', 17), ('=-(1+2)/6', -.5), ('1e-3+2E-3', .003), ('01/20', .05), ('=2×3÷4', 1.5)]:
            self.assertEqual(evaluate_number(value), expected)
        self.assertEqual(finite_number('=1/20', 'OD'), .05)
    def test_unsafe_or_invalid_inputs(self):
        for value in ['=1/0', '=1+', '=2**3', '1//2', 'NaN', 'Infinity', '1e309', '__import__("os")', 'x.y', '((2)', '('.__mul__(300) + '1' + ')'.__mul__(300)]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                evaluate_number(value)
    def test_headerless_formulas_preserved_as_data(self):
        df, meta = read_table_from_raw_text('=1/20,=2/10\n=1/40,=3/10')
        self.assertNotIn('error', meta)
        self.assertEqual(len(df), 2)
        self.assertEqual(df.iloc[0,0], '=1/20')
    def test_options_and_dimensionless_axis(self):
        options = normalize_options({'dose_basis': 'dimensionless', 'dilution_factor': '=8/4', 'reference_assigned_value': '=20/2'})
        self.assertEqual(options['reference_assigned_value'], 10)
        coordinate = coordinate_options(options, 'test')
        self.assertEqual(coordinate['dose_unit'], 'dimensionless dose')
if __name__ == '__main__': unittest.main()
