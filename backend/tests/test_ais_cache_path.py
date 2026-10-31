import os
import subprocess
import sys
import unittest


class AisCachePathTests(unittest.TestCase):
    def test_the_flatpak_data_path_overrides_the_read_only_package_path(self):
        expected = "/tmp/cascade-sdr-test/ais_cache.json"
        script = """
import sys
import types
pyais = types.ModuleType('pyais')
pyais.decode = lambda value: value
sys.modules['pyais'] = pyais
numpy = types.ModuleType('numpy')
numpy.ndarray = object
sys.modules['numpy'] = numpy
from app.modes.ais import CACHE_PATH
print(CACHE_PATH)
"""
        env = os.environ.copy()
        env["PYTHONPATH"] = "backend"
        env["AIS_CACHE_PATH"] = expected
        result = subprocess.run(
            [sys.executable, "-c", script],
            check=True,
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertEqual(result.stdout.strip(), expected)


if __name__ == "__main__":
    unittest.main()
