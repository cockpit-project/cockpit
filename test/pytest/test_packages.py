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

import pytest

from cockpit.packages import parse_accept_language


@pytest.mark.parametrize("test_input,expected", [
                         ('de-at, zh-CH, en,', ['de-at', 'zh-ch', 'en']),
                         ('es-es, nl;q=0.8, fr;q=0.9', ['es-es', 'fr', 'nl']),
                         ('fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7, *;q=0.5', ['fr-ch', 'fr', 'en', 'de', '*'])])
def test_parse_accept_language(test_input, expected):
    assert parse_accept_language({'Accept-Language': test_input}) == expected
