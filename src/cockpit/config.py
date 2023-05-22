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
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

import configparser
import logging
import os
from pathlib import Path

from cockpit._vendor.systemd_ctypes import bus

logger = logging.getLogger(__name__)

ETC_COCKPIT = Path('/etc/cockpit')
XDG_CONFIG_HOME = Path(os.getenv('XDG_CONFIG_HOME') or os.path.expanduser('~/.config'))
DOT_CONFIG_COCKPIT = XDG_CONFIG_HOME / 'cockpit'


class Config(bus.Object, interface='cockpit.Config'):
    def __init__(self):
        self.reload()

    @bus.Interface.Method(out_types='s', in_types='ss')
    def get_string(self, section, key):
        try:
            return self.config[section][key]
        except KeyError as exc:
            raise bus.BusError('cockpit.Config.KeyError', f'key {key} in section {section} does not exist') from exc

    @bus.Interface.Method(out_types='u', in_types='ssuuu')
    def get_u_int(self, section, key, default, maximum, minimum):
        try:
            value = self.config[section][key]
        except KeyError:
            return default

        try:
            int_val = int(value)
        except ValueError:
            logger.warning('cockpit.conf: [%s] %s is not an integer', section, key)
            return default

        return min(max(int_val, minimum), maximum)

    @bus.Interface.Method()
    def reload(self):
        self.config = configparser.ConfigParser(interpolation=None)

        config_dirs = os.environ.get('XDG_CONFIG_DIRS', '/etc').split(':')
        for config_dir in config_dirs:
            config_file = os.path.join(config_dir, 'cockpit', 'cockpit.conf')
            if os.path.exists(config_file):
                logger.debug("cockpit.Config: loading %s", config_file)
                self.config.read(config_file)
                break

        # it's ok to not have a config file and thus leave self.config empty


class Environment(bus.Object, interface='cockpit.Environment'):
    variables = bus.Interface.Property('a{ss}')

    @variables.getter
    def get_variables(self):
        return os.environ.copy()
