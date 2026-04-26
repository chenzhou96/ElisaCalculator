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
    @staticmethod
    def _failing_calculator(_df, **_kwargs):
        return [], 'global fitting failed: mock failure', 0, None

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

    def test_calculation_with_non_first_x_column_excludes_x_from_y(self):
        raw_text = (
            'GroupA,Conc,GroupB\n'
            '0.95,1,1.05\n'
            '0.70,2,0.82\n'
            '0.35,4,0.50\n'
            '0.15,8,0.25\n'
        )

        parse_result = parse_workflow_input(raw_text, source_label='Paste')
        self.assertTrue(parse_result.ok)

        calculation_result = calculate_workflow_report(
            parse_result.df,
            calculator_kwargs={'x_col_name': 'Conc'},
        )

        self.assertTrue(calculation_result.ok)
        self.assertEqual(calculation_result.status_msg, 'Success')
        groups = [row['Group'] for row in calculation_result.results]
        self.assertNotIn('Conc', groups)
        self.assertIn('GroupA', groups)
        self.assertIn('GroupB', groups)

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

    def test_calculation_stage_failure_marks_not_ok(self):
        data_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'test_data.csv')
        raw_text, _, err = read_text_file_with_fallbacks(data_file)
        self.assertIsNotNone(raw_text, msg=f'read failed: {err}')
        parse_result = parse_workflow_input(raw_text, source_label='Paste')
        self.assertTrue(parse_result.ok)

        calculation_result = calculate_workflow_report(
            parse_result.df,
            calculator=self._failing_calculator,
        )
        self.assertFalse(calculation_result.ok)
        self.assertIn('global fitting failed', calculation_result.error)
        self.assertEqual(calculation_result.status_msg, 'global fitting failed: mock failure')
        self.assertIsNone(calculation_result.report)

    def test_run_workflow_failure_marks_not_ok(self):
        data_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'test_data.csv')
        raw_text, _, err = read_text_file_with_fallbacks(data_file)
        self.assertIsNotNone(raw_text, msg=f'read failed: {err}')

        result = run_calculation_workflow(
            raw_text,
            source_label='Paste',
            calculator=self._failing_calculator,
        )
        self.assertFalse(result.ok)
        self.assertIn('global fitting failed', result.error)
        self.assertEqual(result.status_msg, 'global fitting failed: mock failure')
        self.assertEqual(result.saved_files, [])
        self.assertIsNone(result.output_dir)

    def test_run_workflow_export_failure_does_not_fail_calculation(self):
        data_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'test_data.csv')
        raw_text, _, err = read_text_file_with_fallbacks(data_file)
        self.assertIsNotNone(raw_text, msg=f'read failed: {err}')

        def failing_output_saver(_detail_obj, _output_dir):
            raise RuntimeError('mock export failure')

        result = run_calculation_workflow(
            raw_text,
            source_label='Paste',
            output_saver=failing_output_saver,
        )

        self.assertTrue(result.ok)
        self.assertEqual(result.status_msg, 'Success')
        self.assertTrue(result.export_warnings)
        self.assertIn('mock export failure', result.export_error)


if __name__ == '__main__':
    unittest.main()
