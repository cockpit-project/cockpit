/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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

import cockpit from 'cockpit';
import React from 'react';
import { superuser } from "superuser";

import { Button, Badge, Card, CardBody, Gallery, Page, PageSection, PageSectionVariants } from '@patternfly/react-core';
import { UserIcon } from '@patternfly/react-icons';
import { account_create_dialog } from "./account-create-dialog.js";

const _ = cockpit.gettext;

function AccountItem({ account, current }) {
    function click(ev) {
        if (!ev)
            return;

        if (ev.type === 'click' && ev.button !== 0)
            return;

        if (ev.type === 'keypress' && ev.key !== "Enter")
            return;

        cockpit.location.go([account.name]);
    }

    return (
        <Card onClick={click} onKeyPress={click} isSelectable isCompact>
            <CardBody className="cockpit-account">
                <UserIcon className="cockpit-account-pic" />
                <div className="cockpit-account-real-name">{account.gecos.split(',')[0]}</div>
                <div className="cockpit-account-user-name">
                    <a href={"#/" + account.name}>{account.name}</a>
                    {current && <Badge className="cockpit-account-badge">{_("Your account")}</Badge>}
                </div>
            </CardBody>
        </Card>
    );
}

export function AccountsList({ accounts, current_user }) {
    const filtered_accounts = accounts.filter(function(account) {
        return !((account.uid < 1000 && account.uid !== 0) ||
                 account.shell.match(/^(\/usr)?\/sbin\/nologin/) ||
                 account.shell === '/bin/false');
    });

    filtered_accounts.sort(function (a, b) {
        if (current_user === a.name) return -1;
        else if (current_user === b.name) return 1;
        else if (!a.gecos) return -1;
        else if (!b.gecos) return 1;
        else return a.gecos.localeCompare(b.gecos);
    });

    return (
        <Page id="accounts">
            { superuser.allowed &&
                <PageSection variant={PageSectionVariants.light}>
                    <Button id="accounts-create" onClick={() => account_create_dialog(accounts)}>
                        {_("Create new account")}
                    </Button>
                </PageSection>
            }
            <PageSection id="accounts-list">
                <Gallery className='ct-system-overview' hasGutter>
                    { filtered_accounts.map(a => <AccountItem key={a.name} account={a} current={current_user == a.name} />) }
                </Gallery>
            </PageSection>
        </Page>
    );
}
