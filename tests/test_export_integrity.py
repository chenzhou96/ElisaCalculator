import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
from elisa_calculator.common import make_output_dir
from elisa_calculator.io.writers import save_outputs
from elisa_calculator.visualization.plotting import create_preview_plots


def report():
    return {'options': {'input_mode': 'dilution_step', 'start_concentration': None},
            'summary_rows': [{'Group': '=unsafe', 'EC50': 0.02, 'Warning': ''}],
            'unknown_results': [{'Sample': 'S1', 'Concentration': 0.03}],
            'detailed_rows': [
                {'group_name': name, 'x': np.array([-3., -2., -1., 0.]),
                 'y': np.array([0.1, 0.5, 0.9, 1.0]),
                 'params': {'A': 0., 'B': 1., 'C': -2., 'D': 1.},
                 'r2': .98, 'status': 'Success', 'warning_list': [],
                 'processed_points': [{'raw_x': 1., 'raw_y': float('nan'), 'excluded': True}]}
                for name in ['A/B', 'A:B']]}


class ExportIntegrityTests(unittest.TestCase):
    def test_preview_does_not_require_files(self):
        with patch('elisa_calculator.visualization.plotting.BytesIO', wraps=__import__('io').BytesIO):
            plots = create_preview_plots(report())
        self.assertEqual(len(plots), 3)
        self.assertTrue(all(p['data_url'].startswith('data:image/png;base64,iVBOR') for p in plots))

    def test_sanitized_names_do_not_collide_and_record_is_strict_json(self):
        with tempfile.TemporaryDirectory() as directory:
            result = save_outputs(report(), directory)
            self.assertFalse(result['warnings'])
            self.assertTrue(Path(directory, '001_A_B_fit.png').exists())
            self.assertTrue(Path(directory, '002_A_B_fit.png').exists())
            record = json.loads(Path(directory, 'Analysis_Record.json').read_text())
            self.assertIsNone(record['report']['detailed_rows'][0]['processed_points'][0]['raw_y'])
            self.assertIn("'=unsafe", Path(directory, 'EC50_Summary.csv').read_text(encoding='utf-8-sig'))
            self.assertTrue(Path(directory, 'Input_Audit.csv').exists())
            self.assertTrue(Path(directory, 'Unknown_Samples.csv').exists())

    def test_partial_export_truth(self):
        with tempfile.TemporaryDirectory() as directory, patch('elisa_calculator.io.writers.plot_single_group', side_effect=OSError('disk full')):
            result = save_outputs(report(), directory)
            self.assertEqual(len(result['warnings']), 2)
            self.assertFalse(any(p.endswith('_fit.png') for p in result['saved_files']))
            self.assertTrue(any(p.endswith('EC50_Summary.csv') for p in result['saved_files']))

    def test_same_second_runs_have_unique_directories(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict('os.environ', {'XDG_CACHE_HOME': directory}):
            self.assertNotEqual(make_output_dir(), make_output_dir())
