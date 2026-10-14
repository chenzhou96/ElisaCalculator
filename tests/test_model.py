import unittest

import numpy as np

from elisa_calculator.core.model import (
    four_param_logistic,
    global_four_param_logistic_model,
)


class TestGlobalModelIndices(unittest.TestCase):
    def test_each_group_matches_its_own_curve(self):
        x = np.array([[-2.0, 0.0], [1.0, 3.0]])
        for dtype in (np.int64, np.uint64, np.float64):
            with self.subTest(dtype=dtype):
                indices = np.array([[1, 0], [1, 0]], dtype=dtype)
                actual = global_four_param_logistic_model(
                    x, indices, np.int64(2), 0.1, 2.0, 1.2, -0.5, -0.8, 0.7,
                )
                expected = np.where(
                    indices == 0,
                    four_param_logistic(x, 0.1, 1.2, -0.5, 2.0),
                    four_param_logistic(x, 0.1, -0.8, 0.7, 2.0),
                )
                np.testing.assert_array_equal(actual, expected)

    def test_scalar_and_empty_inputs_keep_their_shapes(self):
        scalar = global_four_param_logistic_model(0.0, 0, 1, 0.0, 1.0, 1.0, 0.0)
        self.assertEqual(scalar.shape, ())
        self.assertEqual(float(scalar), 0.5)
        empty = global_four_param_logistic_model([], [], 1, 0.0, 1.0, 1.0, 0.0)
        self.assertEqual(empty.shape, (0,))

    def test_fractional_and_nonfinite_indices_are_rejected(self):
        for index in (0.5, -0.5, np.nan, np.inf, -np.inf):
            with self.subTest(index=index):
                with self.assertRaisesRegex(ValueError, 'group_indices'):
                    global_four_param_logistic_model([0.0], [index], 2, 0, 1, 1, 0, 1, 0)

    def test_nonnumeric_and_boolean_indices_are_rejected(self):
        for indices in ([False], ['0'], [0j], np.array([0], dtype=object)):
            with self.subTest(indices=indices):
                with self.assertRaisesRegex(ValueError, 'group_indices'):
                    global_four_param_logistic_model([0.0], indices, 1, 0, 1, 1, 0)

    def test_out_of_range_and_mismatched_indices_are_rejected(self):
        for indices in ([-1], [1], [], [[0]]):
            with self.subTest(indices=indices):
                with self.assertRaisesRegex(ValueError, 'group_indices'):
                    global_four_param_logistic_model([0.0], indices, 1, 0, 1, 1, 0)

    def test_mixed_boolean_numeric_indices_are_rejected_before_coercion(self):
        for indices in ([False, 1], [0, True], [0.0, False]):
            with self.subTest(indices=indices):
                with self.assertRaisesRegex(ValueError, 'group_indices'):
                    global_four_param_logistic_model([0.0, 1.0], indices, 2, 0, 1, 1, 0, 1, 0)

    def test_group_count_must_be_a_positive_integer(self):
        for count in (True, False, 0, -1, 1.0, np.nan, '1', 1j):
            with self.subTest(count=count):
                with self.assertRaisesRegex(ValueError, 'n_groups'):
                    global_four_param_logistic_model([0.0], [0], count, 0, 1, 1, 0)

    def test_parameter_count_validation_is_preserved(self):
        for parameters in ((), (1,), (1, 0, 1)):
            with self.subTest(parameters=parameters):
                with self.assertRaisesRegex(ValueError, 'bc_flat'):
                    global_four_param_logistic_model([0.0], [0], 1, 0, 1, *parameters)

    def test_numpy_group_counts_do_not_overflow_parameter_count(self):
        for count in (np.int64(2**62), np.uint64(2**63)):
            with self.subTest(count=count):
                with self.assertRaisesRegex(ValueError, 'bc_flat'):
                    global_four_param_logistic_model([], [], count, 0, 1)


if __name__ == '__main__':
    unittest.main()
