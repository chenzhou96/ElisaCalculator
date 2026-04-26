import os
import unittest

from elisa_calculator.io.readers import read_text_file_with_fallbacks
from elisa_calculator.services.workflow import (
    calculate_workflow_report,
    export_workflow_outputs,
    parse_workflow_input,
    run_calculation_workflow,
)


class TestWorkflow(unittest.TestCase):
    def test_parse_stage_failure(self):
        parse_result = parse_workflow_input('')

        self.assertFalse(parse_result.ok)
        self.assertTrue(parse_result.error)
        self.assertIsNone(parse_result.df)

    def test_staged_workflow_success(self):
        data_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'test_data.csv')
        raw_text, _, err = read_text_file_with_fallbacks(data_file)
        self.assertIsNotNone(raw_text, msg=f'read failed: {err}')

        parse_result = parse_workflow_input(raw_text, source_label='Paste')
        self.assertTrue(parse_result.ok)

        calculation_result = calculate_workflow_report(parse_result.df)
        self.assertTrue(calculation_result.ok)
        self.assertEqual(calculation_result.status_msg, 'Success')
        self.assertIsNotNone(calculation_result.report)
        self.assertTrue(calculation_result.report.fit_success)

        export_result = export_workflow_outputs(calculation_result.report, source_label='Paste')
        self.assertTrue(export_result.ok)
        self.assertFalse(export_result.skipped)
        self.assertIsNotNone(export_result.output_dir)
        self.assertGreaterEqual(len(export_result.saved_files), 1)

    def test_calculation_with_column_mapping(self):
        data_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'test_data.csv')
        raw_text, _, err = read_text_file_with_fallbacks(data_file)
        self.assertIsNotNone(raw_text, msg=f'read failed: {err}')

        parse_result = parse_workflow_input(raw_text, source_label='Paste')
        self.assertTrue(parse_result.ok)

        columns = list(parse_result.df.columns)
        self.assertGreaterEqual(len(columns), 2)

        calculation_result = calculate_workflow_report(
            parse_result.df,
            calculator_kwargs={
                'x_col_name': columns[0],
                'y_cols_names': columns[1:],
            },
        )

        self.assertTrue(calculation_result.ok)
        self.assertEqual(calculation_result.status_msg, 'Success')
        self.assertGreaterEqual(len(calculation_result.results), 1)

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
        self.assertIsNotNone(result.report)
        self.assertTrue(result.report.fit_success)
        self.assertIsNotNone(result.output_dir)


if __name__ == '__main__':
    unittest.main()
