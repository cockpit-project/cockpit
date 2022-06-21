# This file is part of Cockpit.
#
# Copyright (C) 2022 Red Hat, Inc.
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
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

import logging

from ..channel import Channel

logger = logging.getLogger(__name__)


class MetricsChannel(Channel):
    payload = 'metrics1'

    def do_open(self, options):
        assert options['source'] == 'internal'
        assert options['interval'] == 3000
        assert 'omit-instances' not in options
        assert options['metrics'] == [
            {"name": "cpu.basic.user", "derive": "rate"},
            {"name": "cpu.basic.system", "derive": "rate"},
            {"name": "cpu.basic.nice", "derive": "rate"},
            {"name": "memory.used"},
        ]
