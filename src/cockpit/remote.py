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


from typing import Dict

from .router import RoutingError, RoutingRule


# We don't support remote hosts yet.
# Reject open messages with host fields which don't match our init_host.
class HostRoutingRule(RoutingRule):
    def apply_rule(self, options: Dict[str, object]) -> None:
        assert self.router is not None

        host = options.get('host')
        if host is not None and host != self.router.init_host:
            raise RoutingError('not-supported')

    def shutdown(self):
        pass  # nothing here (yet)
