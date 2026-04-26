import os
import unittest

import numpy as np

from elisa_calculator.core.processing import calculate_ec50_global_df
from elisa_calculator.io.readers import read_table_from_raw_text, read_text_file_with_fallbacks


class TestProcessing(unittest.TestCase):
    def test_calculate_ec50_global_df_from_test_data(self):
        data_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'test_data.csv')
        raw_text, _, err = read_text_file_with_fallbacks(data_file)

        self.assertIsNotNone(raw_text, msg=f'read failed: {err}')
        df, meta = read_table_from_raw_text(raw_text)

        self.assertIsNotNone(df)
        self.assertIn(meta['header_mode'], ['user_header', 'auto_default'])

        results, status_msg, removed_count, detail = calculate_ec50_global_df(df)

        self.assertEqual(status_msg, 'Success')
        self.assertGreaterEqual(len(results), 1)
        self.assertIsNotNone(detail)
        self.assertTrue(detail['fit_success'])
        self.assertGreaterEqual(removed_count, 0)

        for row in results:
            self.assertEqual(row['Status'], 'Success')
            self.assertTrue(np.isfinite(row['EC50']))
            self.assertGreater(row['EC50'], 0)


if __name__ == '__main__':
    unittest.main()
