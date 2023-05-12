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

import subprocess

import pytest


@pytest.mark.parametrize('command', [
    # only test src/cockpit; src/systemd_ctypes does not have type annotations yet
    # disable caching, as it otherwise often crashes with "Cannot find component 'inotify' for 'systemd_ctypes...."
    ['mypy', '--no-incremental', 'src/cockpit'],

    ['ruff', 'check', '--no-cache', '.'],

    ['vulture'],
], ids=lambda argv: argv[0])
def test_linter(command, pytestconfig):
    try:
        subprocess.check_call(command, cwd=pytestconfig.rootdir)
    except FileNotFoundError as exc:
        pytest.skip(f'{exc.filename} not installed')
    except subprocess.CalledProcessError:
        pytest.fail()
