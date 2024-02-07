/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2024 Red Hat, Inc.
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

/* This is our version of the PatternFly Truncate component. We have
   it since we don't want Patternfly's unconditional tooltip.

   Truncation in the middle doesn't work with Patternsfly's approach
   in mixed RTL/LTR environments, so we only offer truncation at the
   end.
 */

import * as React from "react";
import './cockpit-components-truncate.scss';

export const Truncate = ({
    content,
    ...props
}) => {
    return (
        <span className="pf-v5-c-truncate ct-no-truncate-min-width" {...props}>
            <span className="pf-v5-c-truncate__start">
                {content}
            </span>
        </span>
    );
};
