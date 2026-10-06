#!/usr/bin/env python3
"""Install the finite GPU benchmark into a hash-verified private guest image."""
import importlib.util
import sys
from pathlib import Path

sys.dont_write_bytecode = True

here = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('gpu_package', here / 'package-firefox-gpu-check.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.PAGE = here / 'firefox-gpu-benchmark' / 'benchmark.html'
module.main()
