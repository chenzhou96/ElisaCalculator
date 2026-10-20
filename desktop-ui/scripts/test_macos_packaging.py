"""Cross-platform checks for the Mac packaging contract and smoke-result parser."""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('macos_smoke', Path(__file__).with_name('macos-package-smoke.py'))
SMOKE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SMOKE)


class MacPackagingTests(unittest.TestCase):
    def test_mac_bundle_contains_frozen_engine_and_explicit_signature_limits(self):
        config = json.loads((ROOT / 'desktop-ui/src-tauri/tauri.macos.conf.json').read_text())
        self.assertEqual(config['bundle']['resources'], {'resources/bridge/elisa_bridge': 'bridge/elisa_bridge'})
        self.assertIn('build-bridge-macos.py', config['build']['beforeBuildCommand'])
        self.assertEqual(config['bundle']['macOS']['signingIdentity'], '-')
        self.assertTrue(config['bundle']['macOS']['hardenedRuntime'])
        self.assertEqual(config['bundle']['macOS']['minimumSystemVersion'], '14.0')

    def test_requires_successful_visible_native_window(self):
        valid = '[window startup] visible=Ok(true)\n[window startup result] {"fit_ok":true,"fit_error":null}\n'
        self.assertTrue(SMOKE.startup_result(valid)['fit_ok'])
        for invalid in ('', '[window startup result] {', '[window startup result] {broken}', valid.replace('true', 'false'), valid.replace('Ok(true)', 'Ok(false)'),
                        valid + valid, valid.replace('null', '"failed"')):
            with self.subTest(log=invalid):
                with self.assertRaises(ValueError):
                    SMOKE.startup_result(invalid)

    def test_mac_workflow_does_not_publish_releases_or_use_apple_credentials(self):
        workflow = (ROOT / '.github/workflows/macos-installer.yml').read_text()
        self.assertIn('contents: read', workflow)
        self.assertIn('architecture: arm64', workflow)
        self.assertIn('--target aarch64-apple-darwin', workflow)
        self.assertIn('macos-package-smoke.py', workflow)
        for forbidden in ('secrets.', 'contents: write', 'gh release', 'notarytool', 'spctl --master-disable'):
            self.assertNotIn(forbidden, workflow)


if __name__ == '__main__':
    unittest.main()
