/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2025 Red Hat, Inc.
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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";
import React from "react";

import { CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { DropdownList } from "@patternfly/react-core/dist/esm/components/Dropdown";
import { ExclamationCircleIcon, ExclamationTriangleIcon } from "@patternfly/react-icons";
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Icon } from "@patternfly/react-core/dist/esm/components/Icon/index.js";

import { format_temperature } from "../utils.js";
import { StorageCard, StorageDescription } from "../pages.jsx";
import { StorageBarMenu, StorageMenuItem } from "../storage-controls.jsx";

const _ = cockpit.gettext;

const selftestStatusDescription = {
    // Shared values
    success: _("Successful"),
    aborted: _("Aborted"),
    inprogress: _("In progress"),

    // SATA special values
    interrupted: _("Interrupted"),
    fatal: _("Did not complete"),
    error_unknown: _("Failed (Unknown)"),
    error_electrical: _("Failed (Electrical)"),
    error_servo: _("Failed (Servo)"),
    error_read: _("Failed (Read)"),
    error_handling: _("Failed (Damaged)"),

    // NVMe special values
    ctrl_reset: _("Aborted by a Controller Level Reset"),
    ns_removed: _("Aborted due to a removal of a namespace from the namespace inventory"),
    aborted_format: _("Aborted due to the processing of a Format NVM command"),
    fatal_error: _("A fatal error occurred during the self-test operation"),
    unknown_seg_fail: _("Completed with a segment that failed and the segment that failed is not known"),
    known_seg_fail: _("Completed with one or more failed segments"),
    aborted_unknown: _("Aborted for unknown reason"),
    aborted_sanitize: _("Aborted due to a sanitize operation"),
};

// NVMe reports reasons why selftest failed
const nvmeCriticalWarning = {
    spare: _("Spare capacity is below the threshold"),
    temperature: _("Temperature outside of recommended thresholds"),
    degraded: _("Degraded"),
    readonly: _("All media is in read-only mode"),
    volatile_mem: _("Volatile memory backup failed"),
    pmr_readonly: _("Persistent memory has become read-only")
};

const SmartActions = ({ smart_info }) => {
    const smartSelftestStatus = smart_info.SmartSelftestStatus;

    const runSelfTest = (type) => {
        smart_info.SmartSelftestStart(type, {});
    };

    const abortSelfTest = () => {
        smart_info.SmartSelftestAbort({});
    };

    const testDisabled = smartSelftestStatus === "inprogress";

    const actionItems = (
        <DropdownList>
            <StorageMenuItem isDisabled={testDisabled}
                onClick={() => { runSelfTest('short') }}
            >
                {_("Run short test")}
            </StorageMenuItem>
            <StorageMenuItem isDisabled={testDisabled}
                onClick={() => { runSelfTest('extended') }}
            >
                {_("Run extended test")}
            </StorageMenuItem>
            <StorageMenuItem isDisabled={!testDisabled}
                onClick={() => { abortSelfTest() }}
            >
                {_("Abort test")}
            </StorageMenuItem>
        </DropdownList>
    );

    return (
        <StorageBarMenu isKebab label={_("Actions")} menuItems={actionItems} />
    );
};

export const isSmartOK = (drive_type, smart_info) => {
    return (drive_type === "ata" && !smart_info.SmartFailing) ||
        (drive_type === "nvme" && smart_info.SmartCriticalWarning.length === 0);
};

export const SmartCard = ({ card, smart_info, drive_type }) => {
    const powerOnHours = (drive_type === "ata")
        ? Math.floor(smart_info.SmartPowerOnSeconds / 3600)
        : smart_info.SmartPowerOnHours;

    const smartOK = isSmartOK(drive_type, smart_info);

    const status = selftestStatusDescription[smart_info.SmartSelftestStatus] +
        ((smart_info.SmartSelftestStatus === "inprogress" && smart_info.SmartSelftestPercentRemaining !== -1)
            ? `, ${100 - smart_info.SmartSelftestPercentRemaining}%`
            : "");

    const assesment = (
        <Flex spaceItems={{ default: 'spaceItemsXs' }}>
            { !smartOK &&
                <Icon status="danger">
                    <ExclamationCircleIcon />
                </Icon>
            }
            { drive_type === "ata" && !smartOK &&
                <span className="cockpit-disk-failing">{_("Disk is failing")}</span>
            }
            { drive_type === "nvme" && !smartOK &&
                (<span className="cockpit-disk-failing">
                    {_("Disk is failing") + ": " + smart_info.SmartCriticalWarning.map(reason => nvmeCriticalWarning[reason]).join(", ")}
                </span>)
            }
            { smartOK &&
                <span>{_("Disk is OK")}</span>
            }
            { smart_info.SmartTemperature > 0
                ? <span>({format_temperature(smart_info.SmartTemperature)})</span>
                : null
            }
        </Flex>
    );

    return (
        <StorageCard card={card} actions={<SmartActions smart_info={smart_info} />}>
            <CardBody>
                <DescriptionList isHorizontal horizontalTermWidthModifier={{ default: '20ch' }}>
                    <StorageDescription title={_("Assessment")}>
                        {assesment}
                    </StorageDescription>
                    <StorageDescription title={_("Power on hours")}
                        value={cockpit.format(_("$0 hours"), powerOnHours)}
                    />
                    <StorageDescription title={_("Self-test status")}
                        value={status}
                    />
                    {drive_type === "ata" && smart_info.SmartNumBadSectors > 0 &&
                        <StorageDescription title={_("Number of bad sectors")}>
                            <Flex flexWrap={{ default: "nowrap" }} spaceItems={{ default: "spaceItemsXs" }}>
                                <Icon status="warning">
                                    <ExclamationTriangleIcon />
                                </Icon>
                                {smart_info.SmartNumBadSectors}
                            </Flex>
                        </StorageDescription>
                    }
                    {drive_type === "ata" && smart_info.SmartNumAttributesFailing > 0 &&
                        <StorageDescription title={_("Attributes failing")}>
                            <Flex flexWrap={{ default: "nowrap" }} spaceItems={{ default: "spaceItemsXs" }}>
                                <Icon status="warning">
                                    <ExclamationTriangleIcon />
                                </Icon>
                                {smart_info.SmartNumAttributesFailing}
                            </Flex>
                        </StorageDescription>
                    }
                </DescriptionList>
            </CardBody>
        </StorageCard>
    );
};
