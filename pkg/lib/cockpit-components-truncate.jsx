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
   it since:

   - We don't want Patternfly's unconditional tooltip.
     https://github.com/patternfly/patternfly/issues/6253

   - PF eats white space.
     https://github.com/patternfly/patternfly/issues/6260

   - PF adds whitespace.
     https://github.com/patternfly/patternfly/issues/6261
 */

import * as React from "react";
import './cockpit-components-truncate.scss';

export const TruncateMiddle = ({
    trailingNumChars = 7,
    content,
    ...props
}) => {
    let start, end;

    if (trailingNumChars == 0 || trailingNumChars > content.length) {
        // truncate at end
        start = content;
        end = "";
    } else {
        // truncate in the middle
        start = content.slice(0, -trailingNumChars);
        end = content.slice(-trailingNumChars);
    }

    return (
        <span className="pf-v5-c-truncate ct-no-truncate-min-width" dir="ltr" {...props}>
            { start &&
            <span className="pf-v5-c-truncate__start">
                {start}
            </span>
            }
            {(start.endsWith(" ") || end.startsWith(" ")) ? <>&nbsp;</> : null}
            { end &&
            <span className="pf-v5-c-truncate__end">
                {end}
            </span>
            }
        </span>
    );
};
