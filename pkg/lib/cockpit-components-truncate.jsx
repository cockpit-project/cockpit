/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2024 Mohd Mohsin
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

   See https://github.com/patternfly/patternfly/issues/6253
 */

import * as React from "react";

const minWidthCharacters = 16;

const sliceContent = (str, slice) => [
    str.slice(0, str.length - slice),
    str.slice(-slice),
];

export const Truncate = ({
    className,
    position = "end",
    trailingNumChars = 7,
    content,
    ...props
}) => {
    return (
        <div>
            <span className="pf-v5-c-truncate" {...props}>
                {position === "end" && (
                    <span className="pf-v5-c-truncate__start">
                        {content}
                    </span>
                )}
                {position === "start" && (content.length < minWidthCharacters
                    ? <span>{content}</span>
                    : <span className="pf-v5-c-truncate__end">
                        {content}
                    </span>)
                }
                {position === "middle" &&
                    content.slice(0, content.length - trailingNumChars).length >
                        minWidthCharacters &&
                        (<>
                            <span className="pf-v5-c-truncate__start">
                                {sliceContent(content, trailingNumChars)[0]}
                            </span>
                            <span className="pf-v5-c-truncate__end">
                                {sliceContent(content, trailingNumChars)[1]}
                            </span>
                        </>)}
                {position === "middle" &&
                    content.slice(0, content.length - trailingNumChars)
                            .length <= minWidthCharacters &&
                    content}
            </span>
        </div>
    );
};
