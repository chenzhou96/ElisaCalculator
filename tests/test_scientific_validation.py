"""Request, audit and failure-path regression tests for the scientific backend."""
import json
import math
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

from elisa_calculator.bridge import handle_request, _serialize_response_bytes
from elisa_calculator.core.coordinates import normalize_options, to_log_dose, coordinate_options
from elisa_calculator.core.processing import calculate_ec50_global_df, prepare_group_data
from elisa_calculator.io.readers import read_table_from_raw_text


def input_frame():
    x = np.arange(1., 9.)
    fraction = 2. ** -(x - 1)
    return pd.DataFrame({'step': x, 'Ref': .1 + 2 * fraction ** 2 / (.125**2 + fraction**2),
                         'Sample': .1 + 2 * fraction ** 2 / (.0625**2 + fraction**2)})


class ScientificValidationTests(unittest.TestCase):
    def test_invalid_options_do_not_silently_fall_back(self):
        bad = [{'input_mode':'other'}, {'dilution_factor':1}, {'dilution_factor':11},
               {'dilution_factor':float('nan')}, {'start_concentration':0},
               {'reference_assigned_value':0}, {'blank_value':float('inf')},
               {'first_step':True}, {'allow_extrapolation':'false'},
               {'replicate_mode':'weighted'}, {'unexpected':True}]
        for options in bad:
            with self.subTest(options=options):
                rows,status,_,report = calculate_ec50_global_df(input_frame(),analysis_options=options)
                self.assertNotEqual(status,'Success')
                self.assertIsNone(report)
                self.assertEqual(rows,[])

    def test_extreme_finite_values_fail_explicitly_before_optimizer_overflow(self):
        frame=pd.DataFrame({'x':[1e308,1.1e308,1.2e308,1.3e308], 'y':[.1,.5,1.5,2.]})
        rows,status,_,report=calculate_ec50_global_df(frame,analysis_options={'input_mode':'log_concentration'})
        self.assertNotEqual(status,'Success')
        self.assertIn('safe numerical range',report.fit_error)
        self.assertEqual(rows[0]['Status'],'Skipped')

    def test_selected_columns_are_validated(self):
        for kwargs in ({'x_col_name':'missing'}, {'y_cols_names':['missing']},
                       {'y_cols_names':['Ref','Ref']}, {'y_cols_names':['step']},
                       {'y_cols_names':[]}):
            with self.subTest(kwargs=kwargs):
                prepared,status,_ = prepare_group_data(input_frame(),**kwargs)
                self.assertIsNone(prepared)
                self.assertNotEqual(status,'Success')

    def test_replicate_group_mapping_cannot_double_count(self):
        for mapping in ({'a':['Ref'],'b':['Ref']}, {'a':[]}, {'a':['missing']}, {'Sample':['Ref']}):
            _,status,_,_ = calculate_ec50_global_df(input_frame(),analysis_options={'replicate_groups':mapping})
            self.assertNotEqual(status,'Success')

    def test_flat_curves_fail_with_complete_audit(self):
        frame = pd.DataFrame({'x':np.arange(1,9),'Flat':np.ones(8)})
        rows,status,_,report = calculate_ec50_global_df(frame)
        self.assertNotEqual(status,'Success')
        self.assertFalse(report.fit_success)
        self.assertEqual(len(report.detailed_rows[0].processed_points),8)
        self.assertEqual(rows[0]['Status'],'Skipped')
        self.assertIn('constant response',rows[0]['Warning'])

    def test_skipped_group_does_not_destroy_valid_groups(self):
        frame=input_frame(); frame['Flat']=1
        rows,status,_,report=calculate_ec50_global_df(frame)
        self.assertEqual(status,'Success')
        self.assertEqual(rows[-1]['Status'],'Skipped')
        self.assertEqual(rows[0]['Status'],'Success')
        self.assertTrue(report.warning_list)

    def test_invalid_rows_are_traceable_and_not_clipped(self):
        frame=input_frame(); frame.loc[1,'Ref']=float('inf'); frame.loc[2,'Sample']=-.3
        _,status,removed,report=calculate_ec50_global_df(frame,analysis_options={'blank_mode':'constant','blank_value':.1})
        self.assertEqual(status,'Success'); self.assertEqual(removed,1)
        ref=report.detailed_rows[0].processed_points[1]
        self.assertFalse(ref['included']); self.assertIn('finite',ref['exclusion_reason'])
        sample=report.detailed_rows[1].processed_points[2]
        self.assertTrue(sample['included']); self.assertAlmostEqual(sample['processed_y'],-.4)
        self.assertIn('residual',sample); self.assertIn('fitted_y',sample)

    def test_replicate_means_and_individual_fits_have_explicit_counts(self):
        frame=pd.concat([input_frame(),input_frame()],ignore_index=True)
        rows,_,_,report=calculate_ec50_global_df(frame,analysis_options={'replicate_mode':'mean'})
        self.assertEqual(rows[0]['N'],8)
        self.assertEqual(rows[0]['N_observations'],16)
        self.assertEqual(len(report.detailed_rows[0].processed_points),16)
        self.assertIn('unweighted fit of means',rows[0]['Warning'])

    def test_constant_blank_is_applied_exactly_once(self):
        frame=input_frame(); frame[['Ref','Sample']]+=0.25
        rows,_,_,report=calculate_ec50_global_df(frame,analysis_options={'blank_mode':'constant','blank_value':.25})
        self.assertAlmostEqual(rows[0]['EC50'],.125,places=5)
        self.assertAlmostEqual(report.detailed_rows[0].params.A,.1,places=5)

    def test_standard_relative_axis_rejects_absolute_quantitation(self):
        _,_,_,report=calculate_ec50_global_df(input_frame(),analysis_options={
            'workflow':'standard_curve','standard_group':'Ref','concentration_unit':'ng/mL',
            'unknown_samples':[{'sample_id':'U','od':1.1}]})
        result=report.unknown_results[0]
        self.assertEqual(result['Status'],'Invalid')
        self.assertTrue(math.isnan(result['Concentration']))
        self.assertIn('known standard concentration',result['Warning'])

    def test_invalid_unknowns_do_not_poison_valid_calibration(self):
        cases=[{'od':None},{'od':[]},{'od':['bad']},{'od':1,'dilution_factor':.5},
               {'od':float('inf')},{'od':1,'standard_group':'missing'}]
        _,status,_,report=calculate_ec50_global_df(input_frame(),analysis_options={
            'workflow':'standard_curve','start_concentration':100,'unknown_samples':cases})
        self.assertEqual(status,'Success')
        self.assertEqual(len(report.unknown_results),len(cases))
        for row in report.unknown_results:
            self.assertEqual(row['Status'],'Invalid')
            self.assertTrue(math.isnan(row['Corrected_concentration']))
            self.assertTrue(row['warning_list'])
        self.assertEqual(report.unknown_results[2]['OD_raw'],['bad'])

    def test_raw_and_transformed_coordinates_are_not_confused(self):
        options=normalize_options({'first_step':3,'start_concentration':100,'dilution_factor':10})
        c=coordinate_options(options,'a')
        np.testing.assert_allclose(to_log_dose([3,4,5],c),[2,1,0])
        options=normalize_options({'input_mode':'log_concentration'})
        np.testing.assert_allclose(to_log_dose([-2,-1,0],coordinate_options(options,'a')),[-2,-1,0])

    def test_auto_header_preserves_bad_later_x(self):
        frame,meta=read_table_from_raw_text('1,.9,.8\nbad,.7,.6\n3,.4,.3')
        self.assertEqual(len(frame),3)
        self.assertEqual(meta['header_mode'],'auto_default')
        self.assertEqual(str(frame.iloc[0,0]),'1')

    def test_explicit_header_mode_overrides_numeric_labels(self):
        text='1,2,3\n4,.5,.6\n5,.7,.8'
        frame,meta=read_table_from_raw_text(text,header_mode='present')
        self.assertEqual(len(frame),2)
        self.assertEqual(meta['header_mode'],'user_header')
        frame,_=read_table_from_raw_text(text,header_mode='absent')
        self.assertEqual(len(frame),3)

    def test_duplicate_header_is_rejected_instead_of_auto_renamed(self):
        frame,meta=read_table_from_raw_text('x,OD,OD\n1,.1,.2\n2,.2,.3')
        self.assertIsNone(frame); self.assertIn('重复',meta['error'])

    def test_bridge_preview_structure_and_validation(self):
        result=handle_request({'command':'parse','raw_text':'x,OD\n1,.2\n2,.3','preview_rows':1})
        self.assertTrue(result['ok']); self.assertEqual(result['columns'],['x','OD'])
        self.assertEqual(len(result['preview_rows']),1)
        self.assertFalse(handle_request({'command':'parse','raw_text':'1,.2\n2,.3','preview_rows':0})['ok'])
        self.assertFalse(handle_request([])['ok'])

    @patch('elisa_calculator.visualization.plotting.create_preview_plots',return_value=[{'id':'overview','group_name':'All groups','data_url':'data:image/png;base64,AA=='}])
    def test_bridge_forwards_options_and_keeps_replay_metadata(self,_):
        raw=input_frame().to_csv(index=False)
        response=handle_request({'command':'run','raw_text':raw,'analysis_options':{'reference_group':'Ref','reference_assigned_value':10},'save_outputs':False})
        self.assertTrue(response['ok'])
        self.assertEqual(response['report']['options']['reference_assigned_value'],10)
        self.assertEqual(response['report']['metadata']['raw_input'],raw)
        self.assertAlmostEqual(response['results'][1]['Relative_stock_potency_X'],20,places=5)
        self.assertTrue(response['previews']); self.assertEqual(response['saved_files'],[])
        json.loads(_serialize_response_bytes(response))

    @patch('elisa_calculator.visualization.plotting.create_preview_plots',side_effect=OSError('render failed'))
    def test_preview_failure_does_not_destroy_calculation(self,_):
        response=handle_request({'command':'run','raw_text':input_frame().to_csv(index=False)})
        self.assertTrue(response['ok']); self.assertEqual(response['previews'],[])
        self.assertIn('render failed',response['preview_warnings'][0])


if __name__=='__main__':
    unittest.main()
