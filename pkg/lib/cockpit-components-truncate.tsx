/*
 * Copyright (C) 2024 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
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
}: {
    content: string,
}) => {
    return (
        <span className="pf-v6-c-truncate ct-no-truncate-min-width" {...props}>
            <span className="pf-v6-c-truncate__start">
                {content}
            </span>
        </span>
    );
};
