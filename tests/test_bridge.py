import json
import os
import unittest

from elisa_calculator.bridge import handle_request


class TestBridge(unittest.TestCase):
    @staticmethod
    def _test_data_file():
        return os.path.join(os.path.dirname(os.path.dirname(__file__)), 'test_data.csv')

    def test_parse_request_from_raw_text(self):
        response = handle_request({
            'command': 'parse',
            'raw_text': 'Conc,GroupA,GroupB\n1,0.9,1.1\n2,0.7,0.8\n3,0.2,0.3',
            'preview_rows': 2,
        })

        self.assertTrue(response['ok'])
        self.assertEqual(response['column_count'], 3)
        self.assertEqual(response['row_count'], 3)
        self.assertIn('GroupA', response['preview_text'])

    def test_run_request_from_file_without_export(self):
        response = handle_request({
            'command': 'run',
            'file_path': self._test_data_file(),
            'save_outputs': False,
        })

        self.assertTrue(response['ok'])
        self.assertEqual(response['status_msg'], 'Success')
        self.assertGreaterEqual(len(response['results']), 1)
        self.assertIsNotNone(response['report'])
        self.assertEqual(response['saved_files'], [])
        self.assertTrue(response['exports_skipped'])

    def test_run_request_serializes_numeric_arrays(self):
        response = handle_request({
            'command': 'run',
            'file_path': self._test_data_file(),
            'save_outputs': False,
        })

        first_detail = response['report']['detailed_rows'][0]
        self.assertIsInstance(first_detail['x'], list)
        self.assertIsInstance(first_detail['y'], list)
        self.assertIn('status', first_detail)

        serialized = json.dumps(response, ensure_ascii=False)
        self.assertIn('"ok": true', serialized.lower())

    def test_unknown_command_returns_error(self):
        response = handle_request({'command': 'unknown'})
        self.assertFalse(response['ok'])
        self.assertIn('不支持的命令', response['error'])


if __name__ == '__main__':
    unittest.main()
