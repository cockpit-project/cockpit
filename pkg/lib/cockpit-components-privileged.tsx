/*
 * Copyright (C) 2019 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */
import React from 'react';

import { Button, type ButtonProps } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Tooltip, TooltipPosition } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";

import cockpit from "cockpit";
import { superuser } from 'superuser';
import { useEvent, useLoggedInUser } from "hooks";

/**
 * UI element wrapper for something that requires privilege. When access is not
 * allowed, then wrap the element into a Tooltip.
 *
 * Note that the wrapped element itself needs to be disabled explicitly, this
 * wrapper cannot do this (unfortunately wrapping it into a disabled span does
 * not inherit).
 */
export function Privileged({
    excuse,
    allowed,
    placement,
    tooltipId,
    children
}: {
    excuse: React.ReactNode;
    allowed: boolean | null;
    placement?: TooltipPosition | `${TooltipPosition}` | undefined;
    tooltipId?: string | undefined;
    children: React.ReactNode;
}) {
    // wrap into extra <span> so that a disabled child keeps the tooltip working
    let contents = <span id={allowed ? undefined : tooltipId}>{ children }</span>;
    if (!allowed) {
        contents = (
            <Tooltip position={ placement || TooltipPosition.top} id={ tooltipId + "_tooltip" }
                     content={ excuse }>
                { contents }
            </Tooltip>);
    }
    return contents;
}

/**
 * Convenience element for a Privilege wrapped Button
 */
export const PrivilegedButton = ({
    tooltipId,
    placement,
    excuse,
    buttonId,
    onClick,
    ariaLabel,
    variant,
    isDanger,
    children
}: {
    excuse: string; // must contain a $0, replaced with user name
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    variant?: ButtonProps["variant"];
    isDanger?: boolean;
    placement?: TooltipPosition | `${TooltipPosition}` | undefined;
    buttonId?: string;
    tooltipId?: string;
    ariaLabel?: string;
    children: React.ReactNode;
}) => {
    const user = useLoggedInUser();
    useEvent(superuser, "changed");

    return (
        <Privileged allowed={ superuser.allowed } tooltipId={ tooltipId } placement={ placement }
                    excuse={ cockpit.format(excuse, user?.name ?? '') }>
            <Button isInline isDisabled={ !superuser.allowed }
                {...(buttonId !== undefined && { id: buttonId })}
                {...(variant !== undefined && { variant })}
                {...(isDanger !== undefined && { isDanger })}
                {...(onClick !== undefined && { onClick })}
                {...(ariaLabel !== undefined && { "aria-label": ariaLabel })}
            >
                { children }
            </Button>
        </Privileged>
    );
};
