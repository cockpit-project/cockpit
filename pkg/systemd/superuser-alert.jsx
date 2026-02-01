/*
 * Copyright (C) 2020 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import React from 'react';

import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";

import { LockIcon } from '@patternfly/react-icons';

import { SuperuserButton } from "superuser-dialogs";
import { superuser } from "superuser.js";

const _ = cockpit.gettext;

export const SuperuserAlert = () => {
    if (superuser.allowed || !superuser.configured)
        return null;

    // @Venefilyn: We have a PageSection here to get padding when rendered
    // and avoid that padding when Alert is not rendered. If we start using this
    // in another place we need to make it work in the aforementioned scenarios.
    return (
        <PageSection>
            <Alert className="ct-limited-access-alert"
                variant="warning" isInline
                customIcon={<LockIcon />}
                actionClose={<SuperuserButton />}
                title={_("Web console is running in limited access mode.")} />
        </PageSection>
    );
};
