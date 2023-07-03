import glob
import os
import subprocess
import sys
from typing import Iterable

import pytest

SRCDIR = os.path.realpath(f'{__file__}/../../..')
BUILDDIR = os.environ.get('abs_builddir', SRCDIR)

SKIP = {
    'base1/test-dbus-address.html',
}

XFAIL = {
    'base1/test-websocket.html',
}


# Changed in version 3.10: Added the root_dir and dir_fd parameters.
def glob_py310(fnmatch: str, root_dir: str) -> Iterable[str]:
    prefix = f'{root_dir}/'
    prefixlen = len(prefix)

    for result in glob.glob(f'{prefix}{fnmatch}'):
        assert result.startswith(prefix)
        yield result[prefixlen:]


@pytest.mark.parametrize('html', glob_py310('*/test-*.html', root_dir=f'{SRCDIR}/qunit'))
def test_browser(html):
    if not os.path.exists(f'{BUILDDIR}/test-server'):
        pytest.skip('no test-server')
    if html in SKIP:
        pytest.skip()
    elif html in XFAIL:
        pytest.xfail()

    if 'COVERAGE_RCFILE' in os.environ:
        coverage = ['coverage', 'run', '--parallel-mode', '--module']
    else:
        coverage = []

    # Merge 2>&1 so that pytest displays an interleaved log
    subprocess.run(['test/common/tap-cdp', f'{BUILDDIR}/test-server',
                    sys.executable, '-m', *coverage, 'cockpit.bridge', '--debug',
                    f'./qunit/{html}'], check=True, stderr=subprocess.STDOUT)
