"""Independent known-truth checks for ELISA coordinate and inference semantics.

The synthetic observations deliberately do not call the production 4PL model.
They use the concentration-domain Hill equation as an independent oracle.
"""

import math
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import pandas as pd
from scipy.stats import t

from elisa_calculator.core.model import inverse_four_param_logistic
from elisa_calculator.core.processing import (
    _fit_batch,
    calculate_ec50_global_df,
    prepare_group_data,
)


def response(concentration, ec50, slope=1.8, bottom=0.08, top=2.8):
    """Independent increasing/decreasing concentration-domain 4PL oracle."""
    concentration = np.asarray(concentration, dtype=float)
    fraction = (concentration / float(ec50)) ** float(slope)
    return bottom + (top - bottom) * fraction / (1.0 + fraction)


class IndependentScienceTests(unittest.TestCase):
    def fit(self, df, **options):
        rows, message, _, report = calculate_ec50_global_df(
            df, analysis_options=options
        )
        self.assertEqual(message, "Success", message)
        self.assertIsNotNone(report)
        self.assertTrue(report.fit_success, report.fit_error)
        return {row["Group"]: row for row in rows}, report

    def assert_close(self, actual, expected, *, relative=0.003):
        self.assertTrue(np.isfinite(actual), repr(actual))
        self.assertAlmostEqual(
            float(actual), float(expected), delta=max(abs(expected) * relative, 1e-6)
        )

    def dilution_pair(self):
        steps = np.arange(1.0, 9.0)
        fraction = 2.0 ** (-(steps - 1.0))
        return pd.DataFrame(
            {
                "step": steps,
                "reference": response(fraction, 1 / 8),
                "sample": response(fraction, 1 / 32),
            }
        )

    def test_raw_log_and_step_coordinates_recover_same_absolute_ec50(self):
        steps = np.arange(1.0, 9.0)
        concentration = 100.0 / 2.0 ** (steps - 1.0)
        y = response(concentration, ec50=12.5)
        configurations = (
            (concentration, {"input_mode": "raw_concentration"}),
            (np.log10(concentration), {"input_mode": "log_concentration"}),
            (
                steps,
                {
                    "input_mode": "dilution_step",
                    "start_concentration": 100.0,
                    "dilution_factor": 2.0,
                },
            ),
        )
        for x, options in configurations:
            with self.subTest(mode=options["input_mode"]):
                rows, report = self.fit(
                    pd.DataFrame({"x": x, "sample": y}),
                    concentration_unit="ng/mL",
                    **options,
                )
                row = rows["sample"]
                self.assert_close(row["EC50"], 12.5)
                self.assert_close(row["LogEC50"], math.log10(12.5))
                self.assert_close(report.detailed_rows[0].params.C, math.log10(12.5))
                self.assertEqual(row["EC50_unit"], "ng/mL")
                self.assert_close(row["Slope"], 1.8)

    def test_default_ordinal_steps_mean_increasing_dilution(self):
        rows, _ = self.fit(self.dilution_pair(), reference_group="reference")
        self.assert_close(rows["reference"]["EC50_step"], 4)
        self.assert_close(rows["sample"]["EC50_step"], 6)
        self.assert_close(rows["sample"]["EC50"], 1 / 32)
        self.assert_close(rows["sample"]["Relative_stock_potency_X"], 4)

    def test_reference_assignment_scales_strength_not_curve_or_ec50(self):
        first, _ = self.fit(
            self.dilution_pair(), reference_group="reference", reference_assigned_value=1
        )
        second, _ = self.fit(
            self.dilution_pair(), reference_group="reference", reference_assigned_value=10
        )
        self.assert_close(second["reference"]["Relative_stock_potency_X"], 10)
        self.assert_close(second["sample"]["Relative_stock_potency_X"], 40)
        self.assert_close(second["sample"]["EC50"], first["sample"]["EC50"])
        self.assert_close(second["sample"]["EC50_ratio"], 0.25)

    def test_ec50_and_stock_strength_are_reciprocal_not_same_ratio(self):
        rows, _ = self.fit(self.dilution_pair(), reference_group="reference")
        self.assert_close(rows["sample"]["EC50_ratio"], 0.25)
        self.assert_close(rows["sample"]["Relative_stock_potency_X"], 4)
        self.assert_close(rows["reference"]["EC50_ratio"], 1)

    def test_unequal_starting_concentrations_do_not_erase_stock_difference(self):
        steps = np.arange(1.0, 9.0)
        dilution = 2.0 ** (steps - 1)
        df = pd.DataFrame(
            {
                "step": steps,
                "reference": response(64 / dilution, 8),
                "sample": response(256 / dilution, 8),
            }
        )
        rows, _ = self.fit(
            df,
            input_mode="dilution_step",
            concentration_unit="ng/mL",
            start_concentration=64,
            reference_group="reference",
            reference_assigned_value=10,
            group_options={"sample": {"start_concentration": 256}},
        )
        self.assert_close(rows["reference"]["EC50"], 8)
        self.assert_close(rows["sample"]["EC50"], 8)
        self.assert_close(rows["sample"]["EC50_ratio"], 1)
        self.assert_close(rows["sample"]["Relative_stock_potency_X"], 40)

    def test_unknown_start_cannot_acquire_absolute_units_from_unit_text(self):
        rows, _ = self.fit(
            self.dilution_pair(), input_mode="dilution_step", concentration_unit="ng/mL"
        )
        self.assert_close(rows["reference"]["EC50"], 1 / 8)
        self.assertNotEqual(rows["reference"]["EC50_unit"], "ng/mL")

    def test_factor_ten_and_nondefault_step_origin(self):
        steps = np.arange(5.0, 13.0)
        fraction = 10.0 ** (-(steps - 5))
        rows, _ = self.fit(
            pd.DataFrame({"step": steps, "sample": response(fraction, 1e-3)}),
            input_mode="dilution_step",
            first_step=5,
            dilution_factor=10,
        )
        self.assert_close(rows["sample"]["EC50_step"], 8)
        self.assert_close(rows["sample"]["EC50"], 1e-3)

    def test_increasing_concentration_direction_reverses_step_mapping(self):
        steps = np.arange(1.0, 9.0)
        concentration = 2.0 ** (steps - 1)
        rows, _ = self.fit(
            pd.DataFrame({"step": steps, "sample": response(concentration, 8)}),
            input_mode="dilution_step",
            dilution_direction="decreasing",
            start_concentration=1,
        )
        self.assert_close(rows["sample"]["EC50_step"], 4)
        self.assert_close(rows["sample"]["EC50"], 8)
        self.assert_close(rows["sample"]["Slope"], 1.8)

    def test_decreasing_response_has_negative_slope_without_swapped_plateaus(self):
        concentration = np.geomspace(0.01, 100, 13)
        rows, report = self.fit(
            pd.DataFrame(
                {"dose": concentration, "sample": response(concentration, 1, slope=-1.6)}
            ),
            input_mode="raw_concentration",
        )
        self.assert_close(rows["sample"]["EC50"], 1)
        self.assert_close(rows["sample"]["Slope"], -1.6)
        params = report.detailed_rows[0].params
        self.assertLess(params.A, params.D)
        self.assert_close(params.A, 0.08)
        self.assert_close(params.D, 2.8)

    def test_unsorted_rows_do_not_change_fit_or_dilution_origin(self):
        df = self.dilution_pair()
        shuffled = df.iloc[[3, 7, 0, 4, 6, 1, 5, 2]].reset_index(drop=True)
        rows, _ = self.fit(shuffled, reference_group="reference")
        self.assert_close(rows["reference"]["EC50_step"], 4)
        self.assert_close(rows["sample"]["EC50_step"], 6)
        self.assert_close(rows["sample"]["Relative_stock_potency_X"], 4)

    def test_independent_fit_preserves_different_response_plateaus(self):
        concentration = np.geomspace(0.001, 1000, 19)
        rows, report = self.fit(
            pd.DataFrame(
                {
                    "dose": concentration,
                    "one": response(concentration, 1, bottom=0.1, top=1),
                    "two": response(concentration, 10, bottom=0.6, top=4),
                }
            ),
            input_mode="raw_concentration",
            fit_mode="independent",
        )
        self.assert_close(rows["one"]["EC50"], 1)
        self.assert_close(rows["two"]["EC50"], 10)
        details = {row.group_name: row for row in report.detailed_rows}
        self.assert_close(details["one"].params.D, 1)
        self.assert_close(details["two"].params.D, 4)

    def test_raw_zero_and_negative_are_not_misread_as_log_concentrations(self):
        concentration = np.geomspace(0.01, 100, 9)
        df = pd.DataFrame(
            {
                "x": np.concatenate(([-1, 0], concentration)),
                "sample": np.concatenate(([20, 10], response(concentration, 1))),
            }
        )
        prepared, _, _ = prepare_group_data(
            df, analysis_options={"input_mode": "raw_concentration"}
        )
        self.assertIsNotNone(prepared)
        ready = prepared["ready_groups"][0]
        self.assertEqual(len(ready["x"]), 9)
        np.testing.assert_allclose(np.sort(ready["x"]), np.log10(concentration))

    def test_log_mode_preserves_negative_and_zero_coordinates(self):
        x = np.linspace(-3, 3, 13)
        prepared, _, _ = prepare_group_data(
            pd.DataFrame({"logdose": x, "sample": response(10.0**x, 1)}),
            analysis_options={"input_mode": "log_concentration"},
        )
        self.assertIsNotNone(prepared)
        np.testing.assert_allclose(np.sort(prepared["ready_groups"][0]["x"]), x)

    def test_nonfinite_rows_are_removed_before_optimization(self):
        x = np.linspace(-3, 3, 13)
        df = pd.DataFrame(
            {
                "logdose": np.concatenate((x, [np.inf, -np.inf, 0, 1])),
                "sample": np.concatenate((response(10.0**x, 1), [1, 2, np.inf, np.nan])),
            }
        )
        rows, report = self.fit(df, input_mode="log_concentration")
        self.assert_close(rows["sample"]["EC50"], 1)
        self.assertTrue(np.isfinite(report.detailed_rows[0].x).all())
        self.assertTrue(np.isfinite(report.detailed_rows[0].y).all())

    def test_named_technical_replicates_produce_one_fit_not_two_samples(self):
        steps = np.arange(1.0, 9.0)
        y = response(2.0 ** (-(steps - 1)), 1 / 8)
        df = pd.DataFrame({"step": steps, "a1": y - 0.01, "a2": y + 0.01})
        for mode in ("individual", "mean"):
            with self.subTest(replicate_mode=mode):
                rows, _ = self.fit(
                    df,
                    input_mode="dilution_step",
                    replicate_mode=mode,
                    replicate_groups={"sample": ["a1", "a2"]},
                )
                self.assertEqual(set(rows), {"sample"})
                self.assert_close(rows["sample"]["EC50"], 1 / 8)

    def test_constant_blank_subtraction_does_not_change_ec50(self):
        df = self.dilution_pair()
        df[["reference", "sample"]] += 0.37
        rows, report = self.fit(
            df, blank_mode="constant", blank_value=0.37, reference_group="reference"
        )
        self.assert_close(rows["sample"]["EC50"], 1 / 32)
        self.assert_close(rows["sample"]["Relative_stock_potency_X"], 4)
        self.assert_close(report.detailed_rows[0].params.A, 0.08)

    def test_inverse_round_trip_uses_independent_concentration_formula(self):
        concentrations = np.geomspace(0.03, 300, 17)
        for slope in (-2.0, -0.7, 0.7, 2.0):
            with self.subTest(slope=slope):
                measured = response(concentrations, 3, slope=slope)
                actual = inverse_four_param_logistic(
                    measured, 0.08, slope, math.log10(3), 2.8
                )
                np.testing.assert_allclose(actual, np.log10(concentrations), atol=1e-10)

    def test_inverse_rejects_plateaus_outside_responses_and_flat_slope(self):
        for od in (0.08, 2.8, -0.1, 3.0, np.nan, np.inf):
            with self.subTest(od=od), self.assertRaises(ValueError):
                inverse_four_param_logistic(od, 0.08, 1.8, 0.0, 2.8)
        with self.assertRaises(ValueError):
            inverse_four_param_logistic(1.0, 0.08, 0.0, 0.0, 2.8)

    def standard_fit(self, unknowns, *, slope=1.8, blank=0.0, extrapolate=False):
        concentration = np.geomspace(0.1, 10, 13)
        return self.fit(
            pd.DataFrame(
                {
                    "concentration": concentration,
                    "standard": response(concentration, 1, slope=slope) + blank,
                }
            ),
            workflow="standard_curve",
            input_mode="raw_concentration",
            concentration_unit="ng/mL",
            standard_group="standard",
            unknown_samples=unknowns,
            blank_mode="constant" if blank else "none",
            blank_value=blank,
            allow_extrapolation=extrapolate,
        )

    def test_standard_inverse_returns_assay_and_dilution_corrected_concentration(self):
        truth = {"low": (0.2, 1), "middle": (1.3, 7), "high": (6, 20)}
        unknowns = [
            {
                "sample_id": label,
                "od": float(response(concentration, 1)),
                "dilution_factor": factor,
            }
            for label, (concentration, factor) in truth.items()
        ]
        _, report = self.standard_fit(unknowns)
        results = {row["Sample"]: row for row in report.unknown_results}
        self.assertEqual(set(results), set(truth))
        for label, (concentration, factor) in truth.items():
            with self.subTest(sample=label):
                row = results[label]
                self.assert_close(row["Concentration"], concentration)
                self.assert_close(row["Corrected_concentration"], concentration * factor)
                self.assertEqual(row["Concentration_unit"], "ng/mL")

    def test_standard_inverse_decreasing_assay_returns_correct_concentration(self):
        _, report = self.standard_fit(
            [{"sample_id": "unknown", "od": float(response(2.5, 1, slope=-1.8))}],
            slope=-1.8,
        )
        self.assert_close(report.unknown_results[0]["Concentration"], 2.5)

    def test_unknown_replicates_average_od_before_inverse_and_subtract_blank_once(self):
        expected_concentration = 1.5
        mean_od = float(response(expected_concentration, 1))
        blank = 0.3
        _, report = self.standard_fit(
            [
                {
                    "sample_id": "replicate_unknown",
                    "od": [mean_od + blank - 0.04, mean_od + blank + 0.04],
                    "dilution_factor": 5,
                }
            ],
            blank=blank,
        )
        unknown = report.unknown_results[0]
        self.assert_close(unknown["OD_processed"], mean_od)
        self.assert_close(unknown["Concentration"], expected_concentration)
        self.assert_close(unknown["Corrected_concentration"], 7.5)

    def test_unknown_outside_standard_range_is_not_silently_extrapolated(self):
        _, report = self.standard_fit(
            [{"sample_id": "outside", "od": float(response(30, 1))}]
        )
        row = report.unknown_results[0]
        value = row["Concentration"]
        self.assertTrue(value is None or not np.isfinite(value), row)
        self.assertTrue(row["Warning"], row)

    def test_explicit_extrapolation_is_labeled_and_recovers_synthetic_truth(self):
        _, report = self.standard_fit(
            [{"sample_id": "outside", "od": float(response(30, 1))}],
            extrapolate=True,
        )
        row = report.unknown_results[0]
        self.assert_close(row["Concentration"], 30)
        self.assertTrue(
            "extrapolat" in (row["Warning"] + row["Status"]).lower(), row
        )

    def test_unknown_outside_asymptotes_never_becomes_concentration(self):
        _, report = self.standard_fit(
            [{"sample_id": "outside", "od": 4.0}], extrapolate=True
        )
        row = report.unknown_results[0]
        value = row["Concentration"]
        self.assertTrue(value is None or not np.isfinite(value), row)

    def test_nonzero_noise_intervals_are_log_symmetric_and_concentration_asymmetric(self):
        x = np.linspace(-2, 2, 17)
        noise = 0.012 * np.sin(np.arange(len(x)) * 1.7)
        rows, _ = self.fit(
            pd.DataFrame({"x": x, "sample": response(10.0**x, 1.3) + noise}),
            input_mode="log_concentration",
        )
        row = rows["sample"]
        self.assertGreater(row["LogEC50_SE"], 0)
        self.assertLess(row["EC50_CI_low"], row["EC50"])
        self.assertGreater(row["EC50_CI_high"], row["EC50"])
        self.assert_close(10.0 ** row["LogEC50_CI_low"], row["EC50_CI_low"])
        self.assert_close(10.0 ** row["LogEC50_CI_high"], row["EC50_CI_high"])
        self.assert_close(
            math.sqrt(row["EC50_CI_low"] * row["EC50_CI_high"]), row["EC50"]
        )

    def test_reference_self_comparison_has_exact_ratio_and_interval(self):
        df = self.dilution_pair()
        df["reference"] += 0.012 * np.sin(np.arange(len(df)) * 1.7)
        df["sample"] += 0.008 * np.cos(np.arange(len(df)) * 1.5)
        rows, _ = self.fit(
            df, reference_group="reference", reference_assigned_value=10
        )
        row = rows["reference"]
        for field in ("EC50_ratio", "EC50_ratio_CI_low", "EC50_ratio_CI_high"):
            self.assert_close(row[field], 1)
        for field in (
            "Relative_stock_potency_X",
            "Relative_stock_potency_X_CI_low",
            "Relative_stock_potency_X_CI_high",
        ):
            self.assert_close(row[field], 10)

    def test_raw_physical_concentrations_do_not_imply_original_stock_strength(self):
        concentration = np.geomspace(0.01, 100, 17)
        rows, _ = self.fit(
            pd.DataFrame(
                {
                    "concentration": concentration,
                    "reference": response(concentration, 2),
                    "sample": response(concentration, 0.5),
                }
            ),
            input_mode="raw_concentration",
            reference_group="reference",
        )
        self.assert_close(rows["sample"]["EC50_ratio"], 0.25)
        strength = rows["sample"]["Relative_stock_potency_X"]
        self.assertTrue(strength is None or not np.isfinite(strength))

    def test_two_distinct_doses_cannot_identify_four_parameters_despite_many_replicates(self):
        concentration = np.repeat([0.1, 10], 8)
        rows, _, _, report = calculate_ec50_global_df(
            pd.DataFrame(
                {"concentration": concentration, "sample": response(concentration, 1)}
            ),
            analysis_options={"input_mode": "raw_concentration"},
        )
        if report is not None and report.fit_success:
            self.assertFalse(any(row["Status"] == "Success" for row in rows), rows)

    def test_incompatible_concentration_units_are_not_numerically_compared(self):
        rows, _ = self.fit(
            self.dilution_pair(),
            input_mode="dilution_step",
            start_concentration=1,
            concentration_unit="ng/mL",
            reference_group="reference",
            group_options={"sample": {"concentration_unit": "ug/mL"}},
        )
        for field in ("EC50_ratio", "Relative_stock_potency_X"):
            value = rows["sample"][field]
            self.assertTrue(value is None or not np.isfinite(value), rows["sample"])

    def test_separate_group_dilution_factors_recover_same_relative_stock_truth(self):
        steps = np.arange(1.0, 9.0)
        reference_fraction = 2.0 ** (-(steps - 1))
        sample_fraction = 4.0 ** (-(steps - 1))
        rows, _ = self.fit(
            pd.DataFrame(
                {
                    "step": steps,
                    "reference": response(reference_fraction, 1 / 8),
                    "sample": response(sample_fraction, 1 / 32),
                }
            ),
            input_mode="dilution_step",
            reference_group="reference",
            group_options={"sample": {"dilution_factor": 4}},
        )
        self.assert_close(rows["reference"]["EC50_step"], 4)
        self.assert_close(rows["sample"]["EC50_step"], 3.5)
        self.assert_close(rows["sample"]["Relative_stock_potency_X"], 4)

    def test_ratio_interval_includes_both_midpoint_variances_and_shared_covariance(self):
        df = self.dilution_pair()
        df["reference"] += 0.014 * np.sin(np.arange(len(df)) * 1.7)
        df["sample"] += 0.010 * np.cos(np.arange(len(df)) * 1.5)
        rows, report = self.fit(df, reference_group="reference")
        details = {item.group_name: item for item in report.detailed_rows}
        # Differentiate the Hill equation analytically in the documented
        # optimization coordinates [A, ln(D-A), ln|B_ref|, C_ref, ln|B_s|, C_s].
        blocks = []
        squared_error = 0.0
        for group_index, name in enumerate(("reference", "sample")):
            detail = details[name]
            x, y, p = detail.x, detail.y, detail.params
            sigmoid = 1.0 / (1.0 + np.exp(-np.log(10.0) * p.B * (x - p.C)))
            predicted = p.A + (p.D - p.A) * sigmoid
            common = (p.D - p.A) * sigmoid * (1 - sigmoid) * np.log(10.0) * p.B
            jacobian = np.zeros((len(x), 6))
            jacobian[:, 0] = 1
            jacobian[:, 1] = (p.D - p.A) * sigmoid
            jacobian[:, 2 + 2 * group_index] = common * (x - p.C)
            jacobian[:, 3 + 2 * group_index] = -common
            blocks.append(jacobian)
            squared_error += float(np.sum((y - predicted) ** 2))
        full_jacobian = np.vstack(blocks)
        _, singular, vh = np.linalg.svd(full_jacobian, full_matrices=False)
        degrees = len(full_jacobian) - full_jacobian.shape[1]
        covariance = (vh.T / singular**2) @ vh * squared_error / degrees
        expected_variance = covariance[3, 3] + covariance[5, 5] - 2 * covariance[3, 5]
        self.assertGreater(abs(covariance[3, 5]), 1e-8)
        half_width = float(t.ppf(0.975, degrees)) * math.sqrt(expected_variance)
        delta = rows["sample"]["LogEC50"] - rows["reference"]["LogEC50"]
        self.assert_close(rows["sample"]["EC50_ratio_CI_low"], 10 ** (delta - half_width), relative=1e-5)
        self.assert_close(rows["sample"]["EC50_ratio_CI_high"], 10 ** (delta + half_width), relative=1e-5)
        self.assert_close(rows["sample"]["Relative_stock_potency_X_CI_low"], 10 ** (-delta - half_width), relative=1e-5)
        self.assert_close(rows["sample"]["Relative_stock_potency_X_CI_high"], 10 ** (-delta + half_width), relative=1e-5)

    def test_covariance_does_not_silently_discard_identifiable_weak_direction(self):
        # A controlled full-rank optimizer result isolates covariance arithmetic.
        # pinv(J.T @ J) incorrectly truncates the last direction because it
        # squares condition=1e8 to 1e16, even though the fit accepts condition<1e10.
        x = np.linspace(-2, 2, 6)
        y = response(10.0**x, 1)
        group = {"x": x, "y": y, "group_index": 0}
        jacobian = np.zeros((6, 4))
        jacobian[:4, :4] = np.diag([1.0, 0.1, 1e-6, 1e-8])
        residuals = np.full(6, 0.01)
        result = SimpleNamespace(
            success=True,
            x=np.array([0.08, math.log(2.72), math.log(1.8), 0.0]),
            fun=residuals,
            jac=jacobian,
        )
        with patch("elisa_calculator.core.processing.least_squares", return_value=result):
            estimates, covariance, diagnostics = _fit_batch([group])
        self.assertEqual(diagnostics["jacobian_rank"], 4)
        self.assert_close(diagnostics["jacobian_condition"], 1e8)
        expected = float(residuals @ residuals) / 2 / 1e-16
        self.assertIsNotNone(covariance)
        self.assert_close(covariance[3, 3], expected, relative=1e-10)
        self.assert_close(estimates[0]["log_ec50_se"], math.sqrt(expected), relative=1e-10)

    def test_opposite_response_directions_suppress_comparison(self):
        steps = np.arange(1.0, 9.0)
        fraction = 2.0 ** (-(steps - 1))
        rows, _ = self.fit(
            pd.DataFrame(
                {
                    "step": steps,
                    "reference": response(fraction, 1 / 8),
                    "sample": response(fraction, 1 / 32, slope=-1.8),
                }
            ),
            reference_group="reference",
        )
        row = rows["sample"]
        for key in ("EC50_ratio", "Relative_stock_potency_X"):
            self.assertTrue(row[key] is None or not np.isfinite(row[key]), row)
        self.assertIn("opposite", row["Warning"].lower())

    def test_nonparallel_slopes_require_midpoint_comparison_qualification(self):
        steps = np.arange(1.0, 9.0)
        fraction = 2.0 ** (-(steps - 1))
        rows, _ = self.fit(
            pd.DataFrame(
                {
                    "step": steps,
                    "reference": response(fraction, 1 / 8, slope=1),
                    "sample": response(fraction, 1 / 32, slope=2),
                }
            ),
            reference_group="reference",
        )
        self.assertIn("nonparallel", rows["sample"]["Warning"].lower())
        self.assertIn("midpoint", rows["sample"]["Warning"].lower())

    def test_independent_plateaus_require_common_response_potency_qualification(self):
        steps = np.arange(1.0, 9.0)
        fraction = 2.0 ** (-(steps - 1))
        rows, _ = self.fit(
            pd.DataFrame(
                {
                    "step": steps,
                    "reference": response(fraction, 1 / 8, top=1.0),
                    "sample": response(fraction, 1 / 32, top=3.0),
                }
            ),
            reference_group="reference",
            fit_mode="independent",
        )
        self.assertIn("independent plateaus", rows["sample"]["Warning"].lower())
        self.assertIn("midpoint", rows["sample"]["Warning"].lower())

    def test_reference_coverage_warning_is_propagated_to_sample_comparison(self):
        steps = np.arange(1.0, 9.0)
        fraction = 2.0 ** (-(steps - 1))
        rows, _ = self.fit(
            pd.DataFrame(
                {
                    "step": steps,
                    "reference": response(fraction, 1),
                    "sample": response(fraction, 1 / 8),
                }
            ),
            reference_group="reference",
        )
        self.assertIn("not well bracketed", rows["reference"]["Warning"].lower())
        self.assertIn("denominator uncertainty", rows["sample"]["Warning"].lower())

    def test_four_observation_exact_fit_cannot_report_residual_based_ci(self):
        logdose = np.array([-2, -0.5, 0.5, 2])
        rows, _ = self.fit(
            pd.DataFrame({"x": logdose, "sample": response(10.0**logdose, 1)}),
            input_mode="log_concentration",
        )
        row = rows["sample"]
        self.assertTrue(row["LogEC50_SE"] is None or not np.isfinite(row["LogEC50_SE"]))
        self.assertIn("no residual degrees of freedom", row["Warning"].lower())

    def test_inverse_standard_requires_known_concentration_not_just_unit_label(self):
        df = self.dilution_pair()[["step", "reference"]]
        _, report = self.fit(
            df,
            workflow="standard_curve",
            input_mode="dilution_step",
            concentration_unit="ng/mL",
            standard_group="reference",
            unknown_samples=[{"sample_id": "unknown", "od": 1.0}],
        )
        row = report.unknown_results[0]
        self.assertTrue(row["Concentration"] is None or not np.isfinite(row["Concentration"]))
        self.assertIn("known standard concentration", row["Warning"].lower())

    def test_bound_estimate_does_not_receive_unconstrained_wald_ci(self):
        x = np.linspace(-2, 2, 6)
        y = response(10.0**x, 1)
        span = float(np.ptp(y))
        jacobian = np.vstack((np.eye(4), np.zeros((2, 4))))
        result = SimpleNamespace(
            success=True,
            x=np.array([0.08, math.log(span * 100), math.log(1.8), 0.0]),
            fun=np.full(6, 0.01),
            jac=jacobian,
        )
        with patch("elisa_calculator.core.processing.least_squares", return_value=result):
            estimates, covariance, diagnostics = _fit_batch(
                [{"x": x, "y": y, "group_index": 0}]
            )
        self.assertTrue(diagnostics["at_parameter_bound"])
        self.assertIsNone(covariance)
        self.assertFalse(np.isfinite(estimates[0]["log_ec50_se"]))

    def test_seeded_eight_point_dilution_factor_stress_grid(self):
        """48 bounded fits, including seven log10 decades at dilution factor 10.

        These are identifiable 4PL-generated examples, not an assay-validation
        claim. Noisy cases use known Gaussian OD SD=0.1% of the response range.
        """
        random = np.random.default_rng(1062026)
        steps = np.arange(1.0, 9.0)
        for factor in (2, 3, 5, 10):
            concentration = factor ** (-(steps - 1))
            for fit_mode in ("shared", "independent"):
                for midpoint, slope in ((2.5, 1.2), (4.5, 1.8), (6.5, 2.5)):
                    for noise_fraction in (0.0, 0.001):
                        with self.subTest(
                            factor=factor,
                            fit_mode=fit_mode,
                            midpoint=midpoint,
                            slope=slope,
                            noise_fraction=noise_fraction,
                        ):
                            midpoints = {
                                "reference": midpoint,
                                "sample": midpoint + (0.5 if midpoint < 6 else -0.5),
                            }
                            df = pd.DataFrame(
                                {
                                    "step": steps,
                                    **{
                                        name: response(
                                            concentration,
                                            factor ** (-(group_midpoint - 1)),
                                            slope=slope,
                                        )
                                        + random.normal(0, noise_fraction * 2.72, len(steps))
                                        for name, group_midpoint in midpoints.items()
                                    },
                                }
                            )
                            rows, report = self.fit(
                                df,
                                input_mode="dilution_step",
                                dilution_factor=factor,
                                fit_mode=fit_mode,
                                reference_group="reference",
                            )
                            for detail in report.detailed_rows:
                                diagnostics = detail.fit_diagnostics
                                self.assertFalse(diagnostics["at_parameter_bound"])
                                self.assertEqual(
                                    diagnostics["jacobian_rank"],
                                    diagnostics["n_parameters"],
                                )
                                self.assertLess(diagnostics["jacobian_condition"], 1e7)
                            for name, group_midpoint in midpoints.items():
                                row = rows[name]
                                true_ec50 = factor ** (-(group_midpoint - 1))
                                true_strength = factor ** (group_midpoint - midpoint)
                                tolerance = 0.025 if noise_fraction else 1e-6
                                # Relative checks remain strict even for EC50s
                                # near 1e-7; an absolute epsilon would mask errors.
                                self.assertLess(abs(row["EC50"] / true_ec50 - 1), tolerance)
                                self.assertLess(
                                    abs(row["Relative_stock_potency_X"] / true_strength - 1),
                                    tolerance,
                                )
                                self.assertLess(
                                    abs(row["EC50_step"] - group_midpoint),
                                    0.025 if noise_fraction else 1e-6,
                                )
                                self.assertLess(
                                    abs(row["Slope"] / slope - 1),
                                    0.05 if noise_fraction else 1e-6,
                                )


if __name__ == "__main__":
    unittest.main()
