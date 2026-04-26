import os
import unittest

import numpy as np

from elisa_calculator.core.processing import (
    build_calculation_report,
    calculate_ec50_global_df,
    fit_prepared_groups,
    prepare_group_data,
)
from elisa_calculator.core.evaluator import build_group_warning_notes, compute_fit_metrics
from elisa_calculator.io.readers import read_table_from_raw_text, read_text_file_with_fallbacks


class TestProcessing(unittest.TestCase):
    def test_evaluator_metrics_and_warnings(self):
        y_true = np.array([1.0, 0.8, 0.3, 0.1], dtype=float)
        y_pred = np.array([1.0, 0.75, 0.35, 0.12], dtype=float)
        x = np.array([1.0, 2.0, 4.0, 8.0], dtype=float)

        metrics = compute_fit_metrics(y_true, y_pred)

        self.assertIn('r2', metrics)
        self.assertIn('rmse', metrics)
        self.assertTrue(np.isfinite(metrics['rmse']))

        warnings = build_group_warning_notes(x, y_true, ec50=16.0, r2=metrics['r2'])
        self.assertIn('EC50 out of concentration range', warnings)

    def test_processing_stages_success(self):
        data_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'test_data.csv')
        raw_text, _, err = read_text_file_with_fallbacks(data_file)

        self.assertIsNotNone(raw_text, msg=f'read failed: {err}')
        df, _ = read_table_from_raw_text(raw_text)
        self.assertIsNotNone(df)

        prepared, status_msg, removed_count = prepare_group_data(df)
        self.assertEqual(status_msg, 'Success')
        self.assertIsNotNone(prepared)
        self.assertGreaterEqual(removed_count, 0)

        fit_result = fit_prepared_groups(prepared)
        self.assertTrue(fit_result.success)
        self.assertIsNotNone(fit_result.params)

        report = build_calculation_report(prepared, fit_result)
        self.assertTrue(report.fit_success)
        self.assertGreaterEqual(len(report.summary_rows), 1)

    def test_calculate_ec50_global_df_from_test_data(self):
        data_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'test_data.csv')
        raw_text, _, err = read_text_file_with_fallbacks(data_file)

        self.assertIsNotNone(raw_text, msg=f'read failed: {err}')
        df, meta = read_table_from_raw_text(raw_text)

        self.assertIsNotNone(df)
        self.assertIn(meta['header_mode'], ['user_header', 'auto_default'])

        results, status_msg, removed_count, report = calculate_ec50_global_df(df)

        self.assertEqual(status_msg, 'Success')
        self.assertGreaterEqual(len(results), 1)
        self.assertIsNotNone(report)
        self.assertTrue(report.fit_success)
        self.assertGreaterEqual(removed_count, 0)

        for row in results:
            self.assertEqual(row['Status'], 'Success')
            self.assertTrue(np.isfinite(row['EC50']))
            self.assertGreater(row['EC50'], 0)

    def test_log_x_input_with_nonpositive_values_is_not_dropped(self):
        # x values are already in log scale, so non-positive values are valid.
        raw = (
            'logX,GroupA,GroupB\n'
            '-2,0.98,1.02\n'
            '-1,0.86,0.88\n'
            '0,0.55,0.60\n'
            '1,0.22,0.28\n'
            '2,0.10,0.12\n'
        )
        df, _ = read_table_from_raw_text(raw)
        self.assertIsNotNone(df)

        prepared, status_msg, removed_count = prepare_group_data(df, x_col_name='logX')
        self.assertEqual(status_msg, 'Success')
        self.assertIsNotNone(prepared)
        self.assertEqual(removed_count, 0)

        results, calc_status, _, report = calculate_ec50_global_df(df, x_col_name='logX')
        self.assertEqual(calc_status, 'Success')
        self.assertIsNotNone(report)
        self.assertTrue(report.fit_success)
        self.assertGreaterEqual(len(results), 1)


if __name__ == '__main__':
    unittest.main()
