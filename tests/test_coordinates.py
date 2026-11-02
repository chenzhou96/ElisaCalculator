"""Linear-dose conversion must fail closed at floating-point range boundaries."""
import math
import sys
import unittest

from elisa_calculator.core.coordinates import safe_power10


class SafePower10Tests(unittest.TestCase):
    def test_rounded_upper_boundary_is_unavailable_not_an_exception(self):
        boundary = math.log10(sys.float_info.max)
        # The rounded log is within the guard but its power can exceed max float.
        self.assertTrue(math.isnan(safe_power10(boundary)))
        self.assertTrue(math.isnan(safe_power10(math.nextafter(boundary, math.inf))))
        lower = safe_power10(math.nextafter(boundary, -math.inf))
        self.assertTrue(math.isfinite(lower))
        self.assertGreater(lower, 0)
        self.assertLessEqual(lower, sys.float_info.max)

    def test_ordinary_values_and_existing_unavailable_contract(self):
        for exponent, expected in ((0, 1), (1, 10), (-1, .1), (308, 1e308)):
            with self.subTest(exponent=exponent):
                self.assertEqual(safe_power10(exponent), expected)
        for exponent in (math.nan, math.inf, -math.inf, 309, -324):
            with self.subTest(exponent=exponent):
                self.assertTrue(math.isnan(safe_power10(exponent)))


if __name__ == '__main__':
    unittest.main()
