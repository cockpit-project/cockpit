import glob
import os
import subprocess
import sys

import pytest

SRCDIR = os.path.realpath(f'{__file__}/../../..')
BUILDDIR = os.environ.get('abs_builddir', SRCDIR)

SKIP = {
    'base1/test-dbus-address.html',
}

XFAIL = {
    'base1/test-websocket.html',
}


@pytest.mark.parametrize('html', glob.glob('*/test-*.html', root_dir=f'{SRCDIR}/qunit'))
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
