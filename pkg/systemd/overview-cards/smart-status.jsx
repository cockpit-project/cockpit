/*
 * Copyright (C) 2025 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import React, { useState } from 'react';

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { ExclamationCircleIcon } from "@patternfly/react-icons";
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Icon } from '@patternfly/react-core/dist/esm/components/Icon/index.js';

import cockpit from "cockpit";
import { useEvent, useInit } from 'hooks';

function countFailingDisks(proxies) {
    const sataFail = Object.keys(proxies.drives_ata).reduce((acc, drive) => {
        const smart = proxies.drives_ata[drive];
        if (smart.SmartFailing) {
            return acc + 1;
        } else {
            return acc;
        }
    }, 0);

    const nvmeFail = Object.keys(proxies.nvme_controller).reduce((acc, drive) => {
        const smart = proxies.nvme_controller[drive];
        if (smart.SmartCriticalWarning.length > 0) {
            return acc + 1;
        } else {
            return acc;
        }
    }, 0);

    return sataFail + nvmeFail;
}

const proxies = {
    drives_ata: null,
    nvme_controller: null,
};

export const SmartOverviewStatus = () => {
    useEvent(proxies.drives_ata, "changed");
    useEvent(proxies.nvme_controller, "changed");
    const [initDone, setInitDone] = useState(false);

    useInit(async () => {
        const udisksdbus = cockpit.dbus("org.freedesktop.UDisks2");

        const addProxy = (iface) => {
            return udisksdbus.proxies("org.freedesktop.UDisks2." + iface, "/org/freedesktop/UDisks2");
        };

        proxies.drives_ata = addProxy("Drive.Ata");
        proxies.nvme_controller = addProxy("NVMe.Controller");
        await Promise.all(Object.keys(proxies).map(proxy => proxies[proxy].wait()));

        setInitDone(true);
    });

    if (initDone === false || proxies.drives_ata === null || proxies.nvme_controller === null) {
        return;
    }

    const failingDisks = countFailingDisks(proxies);
    if (failingDisks === 0) {
        return;
    }

    return (
        <li id="smart-status">
            <Flex spaceItems={{ default: 'spaceItemsSm' }}>
                <Icon status="danger">
                    <ExclamationCircleIcon />
                </Icon>
                <Button variant="link" component="a" isInline
                    onClick={() => cockpit.jump("/storage")}
                >
                    {cockpit.format(cockpit.ngettext("$0 disk is failing",
                                                     "$0 disks are failing", failingDisks),
                                    failingDisks)}
                </Button>
            </Flex>
        </li>
    );
};
