/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

import React, { useState } from 'react';

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Dropdown, DropdownItem } from '@patternfly/react-core/dist/esm/components/Dropdown/index.js';
import { MenuToggle } from '@patternfly/react-core/dist/esm/components/MenuToggle/index.js';
import { Tooltip, TooltipPosition } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
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

export const StorageButton = ({ id, kind, excuse, onClick, children, ariaLabel, onlyWide, spinner }) => {
    const [spinning, setSpinning] = useState(false);

    return <StorageControl excuse={excuse}
                           content={excuse => (
                               <Button id={id}
                                       aria-label={ariaLabel}
                                       onClick={checked(onClick, setSpinning)}
                                       variant={kind || "secondary"}
                                       isDisabled={!!excuse || (spinner && spinning)}
                                       className={onlyWide ? "show-only-when-wide" : null}
                                       style={excuse ? { pointerEvents: 'none' } : null}
                                       isLoading={spinner ? spinning : undefined}>
                                   {children}
                               </Button>
                           )} />;
};

export const StorageLink = ({ id, excuse, onClick, children }) => (
    <StorageControl excuse={excuse}
                    content={excuse => (
                        <Button onClick={checked(onClick)}
                                style={excuse ? { pointerEvents: 'none' } : null}
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
            <span className="pf-v5-u-text-nowrap">
                {labelText}
            </span>
            <div className={"usage-bar" + (fraction > critical ? " usage-bar-danger" : "") + (short ? " usage-bar-short" : "")}
                 role="progressbar"
                 aria-valuemin="0" aria-valuemax={stats[1]} aria-valuenow={stats[0]}
                 aria-label={cockpit.format(_("Usage of $0"), block)}
                 aria-valuetext={labelText}>
                <div className="usage-bar-indicator usage-bar-other" aria-hidden="true" style={{ width: total_fraction * 100 + "%" }} />
                <div className="usage-bar-indicator" style={{ insetInlineStart: off_fraction * 100 + "%", width: fraction * 100 + "%" }} />
            </div>
        </div>);
};

/* Render a static size that goes well with a short StorageusageBar in
   the same table column.
*/

export const StorageSize = ({ size }) => {
    return (
        <div>
            <span className="pf-v5-u-text-nowrap">
                {utils.fmt_size(size)}
            </span>
            <div className="usage-bar usage-bar-short usage-bar-empty" />
        </div>);
};

export const StorageMenuItem = ({ onClick, onlyNarrow, danger, excuse, children }) => (
    <DropdownItem className={(onlyNarrow ? "show-only-when-narrow" : "") + (danger ? " delete-resource-dangerous" : "")}
                  description={excuse}
                  isDisabled={!!excuse}
                  onClick={checked(onClick, null, excuse)}>
        {children}
    </DropdownItem>
);

export const StorageBarMenu = ({ label, isKebab, onlyNarrow, menuItems }) => {
    const [isOpen, setIsOpen] = useState(false);

    if (!client.superuser.allowed)
        return null;

    const onToggleClick = (event) => {
        setIsOpen(!isOpen);
    };

    const onSelect = (event) => {
        setIsOpen(false);
    };

    const toggle = ref => <MenuToggle ref={ref}
                                      variant="plain"
                                      className={isKebab ? "" : "pf-m-primary"}
                                      onClick={onToggleClick}
                                      isExpanded={isOpen}
                                      aria-label={label}>
        {isKebab ? <EllipsisVIcon /> : <BarsIcon color="white" />}
    </MenuToggle>;

    return (
        <Dropdown className={onlyNarrow ? "show-only-when-narrow" : null}
                  isOpen={isOpen}
                  onSelect={onSelect}
                  onOpenChange={isOpen => setIsOpen(isOpen)}
                  toggle={toggle}
                  popperProps={{ position: "right" }}
                  shouldFocusToggleOnSelect>
            {menuItems}
        </Dropdown>);
};
