"""Subprocess contract tests for source entry or the installed Windows frozen engine."""
import base64
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class PackagedBridgeContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        selected = os.environ.get('ELISA_BRIDGE_TEST_EXECUTABLE')
        cls.frozen = bool(selected)
        if selected:
            executable = Path(selected).resolve(strict=True)
            cls.command = [str(executable)]
        else:
            cls.command = [sys.executable, str(Path(__file__).with_name('bridge_entry.py'))]
        cls.workspace = tempfile.TemporaryDirectory(prefix='elisa-package-测试-')
        cls.environment = dict(os.environ)
        for name in ('PYTHONHOME', 'PYTHONPATH', 'ELISA_PROJECT_ROOT'):
            cls.environment.pop(name, None)
        cls.environment.update(
            PYTHONUTF8='1', PYTHONIOENCODING='utf-8',
            MPLCONFIGDIR=str(Path(cls.workspace.name) / 'matplotlib'),
            XDG_CACHE_HOME=str(Path(cls.workspace.name) / 'cache'),
            LOCALAPPDATA=str(Path(cls.workspace.name) / 'local-app-data'),
        )
        if cls.frozen:
            if sys.platform != 'win32':
                raise unittest.SkipTest('The selected installer bridge is a Windows executable')
            cls.environment['PATH'] = str(Path(os.environ['SystemRoot']) / 'System32')

    @classmethod
    def tearDownClass(cls):
        cls.workspace.cleanup()

    def invoke(self, request=None, args=()):
        result = subprocess.run(
            [*self.command, *args], input=json.dumps(request or {}, ensure_ascii=False).encode('utf-8'),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env=self.environment, cwd=self.workspace.name, timeout=120, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr.decode('utf-8', errors='replace'))
        return json.loads(result.stdout.decode('utf-8'))

    def test_runtime_identity_and_numerical_versions(self):
        info = self.invoke(args=('--build-info',))
        self.assertEqual(info['frozen'], self.frozen)
        self.assertEqual(info['architecture_bits'], 64)
        self.assertTrue(info['python'].startswith('3.12.'), info)
        if self.frozen:
            for name, version in dict(numpy='2.3.5', pandas='2.2.3', scipy='1.17.0', matplotlib='3.10.8').items():
                self.assertEqual(info[name], version)

    def test_utf8_columns_survive_raw_stdin(self):
        response = self.invoke({'command': 'parse', 'raw_text': 'dose,样本甲\n1,2\n2,3\n3,4'})
        self.assertTrue(response['ok'], response)
        self.assertEqual(response['row_count'], 3)
        self.assertEqual(response['columns'], ['dose', '样本甲'])

    def test_normalization_and_errors_keep_json_contract(self):
        normalized = self.invoke({'command': 'normalize_text', 'raw_text': '\ufeffdose\u200b,OD\r\n1,2'})
        self.assertTrue(normalized['ok'], normalized)
        self.assertEqual(normalized['raw_text'], 'dose,OD\n1,2')
        for request in ({'command': 'unsupported'}, {'command': 'parse'}, {'command': 'parse', 'raw_text': 'x,y\n1,2', 'preview_rows': 0}):
            with self.subTest(request=request):
                response = self.invoke(request)
                self.assertFalse(response['ok'], response)
                self.assertTrue(response['error'], response)

    def test_comparative_fit_uses_real_scipy_and_png_previews(self):
        rows = ['concentration,reference,sample']
        for index in range(17):
            concentration = 10 ** (-2 + index / 4)
            reference = 0.1 + 2 / (1 + concentration ** 1.8)
            sample = 0.1 + 2 / (1 + (concentration / 0.25) ** 1.8)
            rows.append(f'{concentration:.17g},{reference:.17g},{sample:.17g}')
        response = self.invoke({
            'command': 'run', 'raw_text': '\n'.join(rows), 'save_outputs': False,
            'analysis_options': {'input_mode': 'raw_concentration', 'reference_group': 'reference'},
        })
        self.assertTrue(response['ok'], response)
        self.assertTrue(response['report']['fit_success'], response['report'])
        groups = {row['Group']: row for row in response['report']['summary_rows']}
        self.assertAlmostEqual(groups['reference']['EC50'], 1.0, places=5)
        self.assertAlmostEqual(groups['sample']['EC50'], 0.25, places=5)
        self.assertFalse(response['preview_warnings'], response['preview_warnings'])
        self.assertGreaterEqual(len(response['previews']), 3)
        for preview in response['previews']:
            prefix, payload = preview['data_url'].split(',', 1)
            self.assertEqual(prefix, 'data:image/png;base64')
            self.assertEqual(base64.b64decode(payload)[:8], b'\x89PNG\r\n\x1a\n')
        self.assertTrue(response['exports_skipped'])
        self.assertEqual(response['saved_files'], [])

    def test_legacy_inverse_and_audit_exports_remain_compatible(self):
        # This is preserved backend API coverage, not a new UI standard/unknown flow.
        rows = ['concentration,standard']
        for index in range(13):
            concentration = 10 ** (-1 + index / 6)
            response = 0.1 + 2 / (1 + concentration ** 1.8)
            rows.append(f'{concentration:.17g},{response:.17g}')
        raw = '\n'.join(rows)
        response = self.invoke({
            'command': 'run', 'raw_text': raw, 'source_label': '兼容性审计', 'save_outputs': True,
            'analysis_options': {
                'workflow': 'standard_curve', 'input_mode': 'raw_concentration',
                'standard_group': 'standard', 'concentration_unit': 'ng/mL',
                'unknown_samples': [{'sample_id': '未知甲', 'od': 0.1 + 2 / (1 + 1.3 ** 1.8), 'dilution_factor': 7}],
            },
        })
        self.assertTrue(response['ok'], response)
        unknown = response['report']['unknown_results'][0]
        self.assertEqual(unknown['Status'], 'Success', unknown)
        self.assertEqual(unknown['Sample'], '未知甲')
        self.assertAlmostEqual(unknown['Concentration'], 1.3, places=5)
        self.assertAlmostEqual(unknown['Corrected_concentration'], 9.1, places=5)
        self.assertFalse(response['export_error'], response)
        self.assertEqual(response['export_warnings'], [])
        files = {Path(filename).name: Path(filename) for filename in response['saved_files']}
        self.assertTrue({'EC50_Summary.csv', 'Input_Audit.csv', 'Unknown_Samples.csv', 'Analysis_Record.json'} <= set(files))
        for path in files.values():
            self.assertGreater(path.stat().st_size, 0)
        record = json.loads(files['Analysis_Record.json'].read_text(encoding='utf-8'))
        self.assertEqual(record['record_schema'], 'elisa-report-v2')
        self.assertEqual(record['report']['metadata']['raw_input'], raw)
        self.assertTrue(math.isfinite(record['report']['summary_rows'][0]['EC50']))


if __name__ == '__main__':
    unittest.main()
