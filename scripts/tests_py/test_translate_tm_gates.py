"""Runs the translation-memory checks of packages/translate with the rest of the Python tests."""
import importlib.util
import os

_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'packages', 'translate', 'tests', 'test_tm_gates.py')
_spec = importlib.util.spec_from_file_location('translate_test_tm_gates', _path)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
Gates = _mod.Gates
