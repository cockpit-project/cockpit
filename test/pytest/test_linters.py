import glob
import os
import subprocess
import sys

import pytest

SRCDIR = os.path.realpath(f'{__file__}/../../..')


@pytest.mark.parametrize('linter', ['flake8', 'pycodestyle', 'pylint', 'vulture'])
def test_lint(linter):
    pytest.importorskip(linter)
    files = glob.glob(f'{SRCDIR}/src/cockpit/**/*.py', recursive=True)
    subprocess.run([sys.executable, '-m', linter, *files], cwd=SRCDIR)
