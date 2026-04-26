import os
import unittest

from elisa_calculator.io.readers import read_text_file_with_fallbacks
from elisa_calculator.services.workflow import run_calculation_workflow


class TestWorkflow(unittest.TestCase):
    def test_workflow_parse_failure(self):
        result = run_calculation_workflow('')
        self.assertFalse(result.ok)
        self.assertTrue(result.error)

    def test_workflow_success(self):
        data_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'test_data.csv')
        raw_text, _, err = read_text_file_with_fallbacks(data_file)
        self.assertIsNotNone(raw_text, msg=f'read failed: {err}')

        result = run_calculation_workflow(raw_text, source_label='Paste')
        self.assertTrue(result.ok)
        self.assertEqual(result.status_msg, 'Success')
        self.assertGreaterEqual(len(result.results), 1)
        self.assertIsNotNone(result.output_dir)


if __name__ == '__main__':
    unittest.main()
