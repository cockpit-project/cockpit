# -*- coding: utf-8 -*-

# This file is part of Cockpit.
#
# Copyright (C) 2019 Red Hat, Inc.
#
# Cockpit is free software; you can redistribute it and/or modify it
# under the terms of the GNU Lesser General Public License as published by
# the Free Software Foundation; either version 2.1 of the License, or
# (at your option) any later version.
#
# Cockpit is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
# Lesser General Public License for more details.
#
# You should have received a copy of the GNU Lesser General Public License
# along with Cockpit; If not, see <http://www.gnu.org/licenses/>.

import os

from .constants import BOTS_DIR

_images_data_dir = None
def get_images_data_dir():
    global _images_data_dir

    if _images_data_dir is None:
        _images_data_dir = os.path.join(os.environ.get("TEST_DATA", BOTS_DIR), "images")

    return _images_data_dir
