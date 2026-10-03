/*
 * Copyright (C) 2016 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import React, { useState } from 'react';

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Dropdown, DropdownItem } from '@patternfly/react-core/dist/esm/components/Dropdown/index.js';
import { MenuToggle } from '@patternfly/react-core/dist/esm/components/MenuToggle/index.js';
import { Tooltip, TooltipPosition } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
import { Icon } from "@patternfly/react-core/dist/esm/components/Icon/index.js";
import { BarsIcon, EllipsisVIcon } from '@patternfly/react-icons';

import cockpit from "cockpit";
import * as utils from "./utils.js";
import client from "./client.js";

import { dialog_open } from "./dialog.jsx";

const _ = cockpit.gettext;

/* StorageControl - a button or similar that triggers
 *                  a privileged action.
 *
 * It can be disabled and will show a tooltip then.  It will
 * automatically disappear when the logged in user doesn't
 * have permission.
 *
 * Properties:
 *
 * - excuse:  If set, the button/link is disabled and will show the
 *            excuse in a tooltip.
 */

class StorageControl extends React.Component {
    render() {
        const excuse = this.props.excuse;
        if (!client.superuser.allowed)
            return <div />;

        if (excuse) {
            return (
                <Tooltip id="tip-storage" content={excuse}
                         position={this.props.excuse_placement || TooltipPosition.top}>
                    <span>
                        { this.props.content(excuse) }
                    </span>
                </Tooltip>
            );
        } else {
            return this.props.content();
        }
    }
}

function checked(callback, setSpinning, excuse) {
    return function (event) {
        if (!event)
            return;

        // only consider primary mouse button for clicks
        if (event.type === 'click' && event.button !== 0)
            return;

        // only consider enter button for keyboard events
        if (event.type === 'KeyDown' && event.key !== "Enter")
            return;

        event.stopPropagation();

        if (excuse) {
            dialog_open({
                Title: _("Sorry"),
                Body: excuse
            });
            return;
        }

        const promise = client.run(callback);
        if (promise) {
            if (setSpinning)
                setSpinning(true);
            promise.finally(() => {
                if (setSpinning)
                    setSpinning(false);
            });
            promise.catch(function (error) {
                console.warn(error.toString());
                dialog_open({
                    Title: _("Error"),
                    Body: error.toString()
                });
            });
        }
    };
}

export const StorageButton = ({ id, kind, excuse, onClick, children, ariaLabel, spinner }) => {
    const [spinning, setSpinning] = useState(false);

    return <StorageControl excuse={excuse}
                           content={excuse => (
                               <Button id={id}
                                       aria-label={ariaLabel}
                                       onClick={checked(onClick, setSpinning)}
                                       variant={kind || "secondary"}
                                       isDisabled={!!excuse || (spinner && spinning)}
                                       isLoading={spinner ? spinning : undefined}>
                                   {children}
                               </Button>
                           )} />;
};

export const StorageLink = ({ id, excuse, onClick, children }) => (
    <StorageControl excuse={excuse}
                    content={excuse => (
                        <Button onClick={checked(onClick)}
                                variant="link"
                                isInline
                                isDisabled={!!excuse}>
                            {children}
                        </Button>
                    )} />
);

// StorageOnOff - OnOff switch for asynchronous actions.
//

export class StorageOnOff extends React.Component {
    constructor() {
        super();
        this.state = { promise: null };
    }

    render() {
        const self = this;

        function onChange(_event, val) {
            const promise = self.props.onChange(val);
            if (promise) {
                promise.catch(error => {
                    dialog_open({
                        Title: _("Error"),
                        Body: error.toString()
                    });
                })
                        .finally(() => { self.setState({ promise: null }) });
            }

            self.setState({ promise, promise_goal_state: val });
        }

        return (
            <StorageControl excuse={this.props.excuse}
                            content={(excuse) => (
                                <Switch isChecked={this.state.promise
                                    ? this.state.promise_goal_state
                                    : this.props.state}
                                                 aria-label={this.props['aria-label']}
                                                 isDisabled={!!(excuse || this.state.promise)}
                                                 onChange={onChange} />
                            )} />
        );
    }
}

/* Render a usage bar showing props.stats[0] out of props.stats[1]
 * bytes in use.  If the ratio is above props.critical, the bar will be
 * in a dangerous color.
 */

export const StorageUsageBar = ({ stats, critical, block, offset, total, short }) => {
    if (!stats)
        return null;

    const fraction = stats[0] / stats[1];
    const off_fraction = offset / stats[1];
    const total_fraction = total / stats[1];
    const labelText = utils.format_fsys_usage(stats[0], stats[1]);

    return (
        <div>
            <span className="usage-text pf-v6-u-text-nowrap">
                {labelText}
            </span>
            <div className={"usage-bar" + (fraction > critical ? " usage-bar-danger" : "") + (short ? " usage-bar-short" : "")}
                 role="progressbar"
                 aria-valuemin={0} aria-valuemax={stats[1]} aria-valuenow={stats[0]}
                 aria-label={cockpit.format(_("Usage of $0"), block)}
                 aria-valuetext={labelText}>
                <div className="usage-bar-indicator usage-bar-other" aria-hidden="true" style={{ width: total_fraction * 100 + "%" }} />
                <div className="usage-bar-indicator" style={{ insetInlineStart: off_fraction * 100 + "%", width: fraction * 100 + "%" }} />
            </div>
        </div>);
};

/* Render a static size that goes well with a short StorageusageBar in
   the same table column, and also works well with the tests.
*/

export const StorageSize = ({ size }) => {
    return (
        <div>
            <span className="usage-text pf-v6-u-text-nowrap">
                {utils.fmt_size(size)}
            </span>
            <div className="usage-bar usage-bar-short usage-bar-empty" />
        </div>);
};

export const StorageMenuItem = ({ onClick, danger, excuse, children, isDisabled }) => (
    <DropdownItem className={danger && !excuse ? " delete-resource-dangerous" : ""}
                  description={excuse}
                  isDisabled={isDisabled || !!excuse}
                  onClick={checked(onClick, null, excuse)}>
        {children}
    </DropdownItem>
);

export const StorageBarMenu = ({ label, isKebab, menuItems }) => {
    const [isOpen, setIsOpen] = useState(false);

    if (!client.superuser.allowed)
        return null;

    // Grab the PF token for a small spacer, and convert to px based on the root element (rem) 
    const rootStyle = getComputedStyle(document.documentElement);
    const menuDistance = parseFloat(rootStyle.getPropertyValue("--pf-t--global--spacer--sm")) *
                         parseFloat(rootStyle.fontSize);
    /*
     * This popperProps object is for kebab menus in the storage list, where
     * space is limited, especially when on small screens or from within Anaconda
     * (via an iframe)
     *
     * - placement: Defaults to below the icon, aligned to the right edge.
     * - flip: If there's not enough space for default, it tries to position the menu above, 
     * then to the side. ("end-start" is for automatic LTR/RTL support)
     * - offset: Vertically centers the menu relative to the icon (using the PF half spacer).
     */
    const storageListKebabPopperProps = {
        placement: "bottom-end",
        modifiers: [
            {
                name: "flip",
                options: {
                    fallbackPlacements: ["top-end", "end-start"]
                }
            },
            {
                name: "offset",
                options: {
                    offset: ({ placement, popper, reference }) =>
                        placement.startsWith("end") || placement.startsWith("start")
                            ? [(reference.height / 2) - (popper.height / 2), menuDistance]
                            : [0, menuDistance]
                }
            }
        ]
    };

    const onToggleClick = (event) => {
        setIsOpen(!isOpen);
    };

    const onSelect = (event) => {
        setIsOpen(false);
    };

    const toggle = ref => (
        <MenuToggle
            ref={ref}
            variant="plain"
            onClick={onToggleClick}
            isExpanded={isOpen}
            aria-label={label}>
            {isKebab ? <EllipsisVIcon /> : <Icon size="lg"><BarsIcon /></Icon>}
        </MenuToggle>
    );

    return (
        <Dropdown isOpen={isOpen}
                  onSelect={onSelect}
                  onOpenChange={isOpen => setIsOpen(isOpen)}
                  toggle={toggle}
                  popperProps={isKebab ? storageListKebabPopperProps : { position: "end" }}
                  appendTo={isKebab ? "parent" : "body"}
                  shouldFocusToggleOnSelect>
            {menuItems}
        </Dropdown>);
};
