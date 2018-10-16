/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

import React from "react";

// TODO - generalize this to arbitrary number of arguments (when needed)
export function fmt_to_fragments(fmt, arg) {
    var index = fmt.indexOf("$0");
    if (index >= 0)
        return <React.Fragment>{fmt.slice(0, index)}{arg}{fmt.slice(index + 2)}</React.Fragment>;
    else
        return fmt;
}
