"""Saved-fit reference edits use scientific fit context, never display ratios."""
from contextlib import ExitStack
from copy import deepcopy
import json
import math
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd
from scipy.stats import t

from elisa_calculator.bridge import handle_request, _serialize_response_bytes
from elisa_calculator.core.normalization import REFERENCE_RESULT_KEYS


def hill(dose, ec50, slope=1.8):
    """Independent concentration-domain oracle, not the production model."""
    ratio = (np.asarray(dose) / ec50) ** slope
    return 0.08 + 2.72 * ratio / (1 + ratio)


class ReferenceRenormalizationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original = cls.run_pair()

    @staticmethod
    def run_pair(*, options=None, noise=False, opposite=False, qualified=False,
                 failed=False):
        steps = np.arange(1., 9.)
        fraction = 2. ** (-(steps - 1))
        reference = hill(fraction, 1 if qualified else 1 / 8)
        sample = hill(fraction, 1 / 32, slope=-1.8 if opposite else 1.8)
        if noise:
            reference += 0.014 * np.sin(np.arange(8) * 1.7)
            sample += 0.010 * np.cos(np.arange(8) * 1.5)
        frame = pd.DataFrame({'step': steps, 'reference': reference, 'sample': sample})
        if failed:
            frame['failed'] = 0.7
        with patch('elisa_calculator.visualization.plotting.create_preview_plots',
                   return_value=[{'name': 'fitted-plot', 'image': 'unchanged-png-bytes'}]):
            result = handle_request({
                'command': 'run', 'raw_text': frame.to_csv(index=False),
                'header_mode': 'present', 'save_outputs': False,
                'analysis_options': {'reference_group': 'reference',
                                     'reference_assigned_value': 10,
                                     **(options or {})},
            })
        if not result['ok']:
            raise AssertionError(result['error'])
        # Exercise exactly the finite-only JSON form a disk record would store.
        return json.loads(_serialize_response_bytes(result))

    def edit(self, original, group='sample', value=7):
        # An accidental parse/refit/model/plot call fails the test immediately.
        with ExitStack() as stack:
            for target in (
                'elisa_calculator.core.processing.least_squares',
                'elisa_calculator.core.processing.prepare_group_data',
                'elisa_calculator.core.processing.fit_prepared_groups',
                'elisa_calculator.core.processing.four_param_logistic',
                'elisa_calculator.bridge.parse_workflow_input',
                'elisa_calculator.bridge.calculate_workflow_report',
                'elisa_calculator.bridge.export_workflow_outputs',
                'elisa_calculator.visualization.plotting.create_preview_plots',
            ):
                stack.enter_context(patch(target, side_effect=AssertionError('no refit permitted')))
            result = handle_request({'command': 'renormalize', 'run_response': original,
                                     'reference_group': group,
                                     'reference_assigned_value': value})
        self.assertTrue(result['ok'], result.get('error'))
        return json.loads(_serialize_response_bytes(result))

    def assert_fit_unchanged(self, before, after):
        a, b = before['report'], after['report']
        for key in ('global_params', 'fit_success', 'fit_error', 'metadata',
                    'unknown_results', 'warning_list'):
            self.assertEqual(json.dumps(a[key], sort_keys=True),
                             json.dumps(b[key], sort_keys=True), key)
        for old, new in zip(a['detailed_rows'], b['detailed_rows']):
            self.assertEqual({k: v for k, v in old.items() if k != 'warning_list'},
                             {k: v for k, v in new.items() if k != 'warning_list'})
        for old, new in zip(a['summary_rows'], b['summary_rows']):
            self.assertEqual({k: v for k, v in old.items() if k not in REFERENCE_RESULT_KEYS},
                             {k: v for k, v in new.items() if k not in REFERENCE_RESULT_KEYS})
        self.assertEqual(before['previews'], after['previews'])
        self.assertEqual(before['preview_warnings'], after['preview_warnings'])

    def test_truth_10x_40x_to_7x_1_75x_preserves_every_fit_field(self):
        before = deepcopy(self.original)
        initial = {row['Group']: row for row in before['results']}
        self.assertAlmostEqual(initial['sample']['Relative_stock_potency_X'], 40, places=7)
        updated = self.edit(before)
        rows = {row['Group']: row for row in updated['results']}
        self.assertAlmostEqual(rows['sample']['Relative_stock_potency_X'], 7, places=12)
        self.assertAlmostEqual(rows['reference']['Relative_stock_potency_X'], 1.75, places=8)
        self.assertEqual(updated['results'], updated['report']['summary_rows'])
        self.assertEqual(updated['report']['options']['reference_group'], 'sample')
        self.assertEqual(updated['report']['comparison']['reference_assigned_value'], 7)
        self.assert_fit_unchanged(before, updated)
        self.assertEqual(before, self.original, 'caller input must not be mutated')

    def test_displayed_or_previously_normalized_x_is_never_used(self):
        corrupted_display = deepcopy(self.original)
        for row in corrupted_display['results'] + corrupted_display['report']['summary_rows']:
            row['Relative_stock_potency_X'] = 999
            row['EC50_ratio'] = 999
            row['Normalized_midpoint_X'] = 999
        changed = self.edit(corrupted_display)
        expected = self.edit(self.original)
        self.assertEqual(changed['results'], expected['results'])

    def test_many_reference_switches_have_no_value_ci_or_warning_drift(self):
        original = self.run_pair(noise=True, qualified=True)
        current = original
        for i in range(60):
            group, assigned = ('sample', 7) if i % 2 == 0 else ('reference', 10)
            current = self.edit(current, group, assigned)
            expected = self.edit(original, group, assigned)
            self.assertEqual(current['results'], expected['results'])
            self.assertEqual(current['report']['comparison'], expected['report']['comparison'])
            self.assert_fit_unchanged(original, current)
        selected = self.edit(current, 'sample', 7)
        sample = next(row for row in selected['results'] if row['Group'] == 'sample')
        self.assertNotIn('denominator uncertainty', sample['Warning'])
        self.assertNotIn('midpoint comparison only', sample['Warning'])
        self.assertEqual(sample['warning_list'],
                         original['report']['metadata']['reference_fit_context']['summary_rows'][1]['warning_list'])

    def test_covariance_cross_terms_recomputed_for_the_new_reference(self):
        original = self.run_pair(noise=True)
        changed = self.edit(original)
        context = original['report']['metadata']['reference_fit_context']
        covariance = np.asarray(context['batch_covariances']['shared'])
        ref_index, sample_index = (context['parameter_c_indexes'][name]
                                   for name in ('reference', 'sample'))
        cross = covariance[ref_index, sample_index]
        self.assertGreater(abs(cross), 1e-8)
        variance = covariance[ref_index, ref_index] + covariance[sample_index, sample_index] - 2 * cross
        degrees = original['report']['detailed_rows'][0]['fit_diagnostics']['residual_degrees_of_freedom']
        half = float(t.ppf(.975, degrees)) * math.sqrt(variance)
        row = next(row for row in changed['results'] if row['Group'] == 'reference')
        delta = row['LogEC50'] - next(r for r in changed['results'] if r['Group'] == 'sample')['LogEC50']
        self.assertAlmostEqual(row['EC50_ratio_CI_low'], 10 ** (delta - half), places=12)
        self.assertAlmostEqual(row['EC50_ratio_CI_high'], 10 ** (delta + half), places=12)
        self.assertAlmostEqual(row['Relative_stock_potency_X_CI_low'], 7 * 10 ** (-delta - half), places=12)
        self.assertAlmostEqual(row['Relative_stock_potency_X_CI_high'], 7 * 10 ** (-delta + half), places=12)
        self.assert_fit_unchanged(original, changed)

    def test_independent_fit_uses_original_full_matrices_and_zero_cross_terms(self):
        original = self.run_pair(noise=True, options={'fit_mode': 'independent'})
        changed = self.edit(original)
        context = original['report']['metadata']['reference_fit_context']
        variance = sum(np.asarray(context['batch_covariances'][name])[
            context['parameter_c_indexes'][name], context['parameter_c_indexes'][name]]
            for name in ('reference', 'sample'))
        degrees = min(d['fit_diagnostics']['residual_degrees_of_freedom']
                      for d in original['report']['detailed_rows'])
        half = float(t.ppf(.975, degrees)) * math.sqrt(variance)
        row = next(r for r in changed['results'] if r['Group'] == 'reference')
        self.assertAlmostEqual(math.log10(row['Relative_stock_potency_X_CI_high'] /
                                         row['Relative_stock_potency_X']), half, places=12)
        self.assertEqual(changed['report']['comparison']['logEC50_covariance']['reference']['sample'], 0)
        self.assertIn('independent plateaus', row['Warning'])
        self.assert_fit_unchanged(original, changed)

    def test_dimensionless_comparison_updates_only_dimensionless_midpoint(self):
        original = self.run_pair(options={'dose_basis': 'dimensionless'})
        changed = self.edit(original)
        rows = {row['Group']: row for row in changed['results']}
        self.assertAlmostEqual(rows['sample']['Normalized_midpoint_X'], 7, places=12)
        self.assertAlmostEqual(rows['reference']['Normalized_midpoint_X'], 1.75, places=8)
        self.assertIsNone(rows['reference']['Relative_stock_potency_X'])
        self.assert_fit_unchanged(original, changed)

    def test_opposite_direction_remains_unavailable_after_reassignment(self):
        original = self.run_pair(opposite=True)
        changed = self.edit(original)
        row = next(r for r in changed['results'] if r['Group'] == 'reference')
        for key in REFERENCE_RESULT_KEYS:
            if key not in ('Warning', 'warning_list'):
                self.assertIsNone(row[key], key)
        self.assertIn('opposite response directions', row['Warning'])
        self.assert_fit_unchanged(original, changed)

    def test_incompatible_dose_domain_remains_unavailable_after_reassignment(self):
        original = self.run_pair(options={'group_options': {
            'reference': {'start_concentration': 8, 'concentration_unit': 'ng/mL'}}})
        changed = self.edit(original)
        row = next(r for r in changed['results'] if r['Group'] == 'reference')
        self.assertIsNone(row['Relative_stock_potency_X'])
        self.assertIsNone(row['EC50_ratio'])
        self.assertIn('incompatible dose domains', row['Warning'])

    def test_nonidentifiable_reference_never_gains_normalized_results(self):
        original = deepcopy(self.original)
        # Simulate a legitimately serialized fit captured at a parameter bound.
        context = original['report']['metadata']['reference_fit_context']
        context['batch_covariances']['shared'] = None
        context['fit_covariance'] = None
        for detail in context['detailed_rows']:
            detail['fit_diagnostics']['at_parameter_bound'] = True
        for detail in original['report']['detailed_rows']:
            detail['fit_diagnostics']['at_parameter_bound'] = True
        changed = self.edit(original)
        for row in changed['results']:
            self.assertIsNone(row['EC50_ratio'])
            self.assertIsNone(row['Relative_stock_potency_X'])
            self.assertIn('not identifiable', row['Warning'])

    def test_missing_or_failed_reference_is_explicit_error(self):
        original = self.run_pair(failed=True)
        for group in ('missing', 'failed', None, '', 7):
            with self.subTest(group=group):
                result = handle_request({'command': 'renormalize', 'run_response': original,
                                         'reference_group': group, 'reference_assigned_value': 7})
                self.assertFalse(result['ok'])
                self.assertIn('successfully fitted group', result['error'])

    def test_legacy_report_and_missing_covariance_are_never_faked(self):
        for key in ('reference_fit_context', 'batch_covariances', 'parameter_c_indexes'):
            with self.subTest(key=key):
                original = deepcopy(self.original)
                metadata = original['report']['metadata']
                if key == 'reference_fit_context':
                    del metadata[key]
                else:
                    del metadata['reference_fit_context'][key]
                result = handle_request({'command': 'renormalize', 'run_response': original,
                                         'reference_group': 'sample', 'reference_assigned_value': 7})
                self.assertFalse(result['ok'])
                self.assertIn('reference editing unavailable', result['error'])

    def test_failed_analysis_and_standard_curve_reports_reject_reference_edit(self):
        failed = deepcopy(self.original)
        failed['report']['fit_success'] = False
        standard = self.run_pair(options={'workflow': 'standard_curve'})
        for original in (failed, standard):
            result = handle_request({'command': 'renormalize', 'run_response': original,
                                     'reference_group': 'sample', 'reference_assigned_value': 7})
            self.assertFalse(result['ok'])
            self.assertIn('reference editing unavailable', result['error'])

    def test_changed_scientific_settings_or_fit_rows_require_a_new_analysis(self):
        for field in ('options', 'summary', 'details'):
            with self.subTest(field=field):
                original = deepcopy(self.original)
                if field == 'options':
                    original['report']['options']['dilution_factor'] = 3
                elif field == 'summary':
                    original['report']['summary_rows'][0]['LogEC50'] += 0.01
                else:
                    original['report']['detailed_rows'][0]['params']['C'] += 0.01
                result = handle_request({'command': 'renormalize', 'run_response': original,
                                         'reference_group': 'sample', 'reference_assigned_value': 7})
                self.assertFalse(result['ok'])
                self.assertIn('run the analysis again', result['error'])

    def test_invalid_reference_assignments_are_rejected_without_side_effects(self):
        for value in (None, True, 0, -1, float('inf'), float('nan'), 'bad'):
            with self.subTest(value=value):
                result = handle_request({'command': 'renormalize', 'run_response': self.original,
                                         'reference_group': 'sample', 'reference_assigned_value': value})
                self.assertFalse(result['ok'])
                self.assertIn('reference_assigned_value', result['error'])

    def test_report_only_command_and_export_state_are_truthful(self):
        response = handle_request({'command': 'renormalize', 'report': self.original['report'],
                                   'reference_group': 'sample', 'reference_assigned_value': 7})
        self.assertTrue(response['ok'], response.get('error'))
        self.assertEqual(response['results'], self.edit(self.original)['results'])
        exported = deepcopy(self.original)
        exported.update(saved_files=['old-summary.csv'], output_dir='/old-export',
                        exports_skipped=False, export_warnings=['old warning'],
                        export_error='old error')
        updated = self.edit(exported)
        self.assertEqual(updated['saved_files'], [])
        self.assertIsNone(updated['output_dir'])
        self.assertTrue(updated['exports_skipped'])
        self.assertEqual(updated['export_error'], '')
        self.assertEqual(updated['export_warnings'], [])


if __name__ == '__main__':
    unittest.main()
