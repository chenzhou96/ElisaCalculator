from pathlib import Path
import json
import platform
import struct
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from elisa_calculator.bridge import main

if __name__ == '__main__':
    if sys.argv[1:] == ['--build-info']:
        import matplotlib
        import numpy
        import pandas
        import scipy

        print(json.dumps({
            'frozen': bool(getattr(sys, 'frozen', False)),
            'python': platform.python_version(),
            'architecture_bits': struct.calcsize('P') * 8,
            'numpy': numpy.__version__,
            'pandas': pandas.__version__,
            'scipy': scipy.__version__,
            'matplotlib': matplotlib.__version__,
        }))
        raise SystemExit(0)
    raise SystemExit(main())
