# This file is part of Cockpit.
#
# Copyright (C) 2023 Red Hat, Inc.
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.

import os
import pytest
import shutil
import subprocess


ROOT_DIR = os.path.realpath(f'{__file__}/../../..')


@pytest.mark.skipif(not shutil.which('mypy'), reason='mypy is not installed')
def test_bridge_mypy():
    # only test src/cockpit; src/systemd_ctypes does not have type annotations yet
    # disable caching, as it otherwise often crashes with "Cannot find component 'inotify' for 'systemd_ctypes...."
    subprocess.check_call(['mypy', '--no-incremental', 'src/cockpit'], cwd=ROOT_DIR)


def test_ruff():
    try:
        subprocess.check_call(['ruff', 'check', '--no-cache', '.'], cwd=ROOT_DIR)
    except FileNotFoundError:
        pytest.skip('ruff not installed')
    except subprocess.CalledProcessError:
        pytest.fail()
