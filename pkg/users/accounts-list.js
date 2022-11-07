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
import React, { useState } from 'react';
import { superuser } from "superuser";

import {
    Button, Badge,
    Card, CardHeader, CardTitle,
    Dropdown, DropdownItem, DropdownSeparator,
    Flex, KebabToggle, Label,
    Page, PageSection,
    SearchInput,
    Text, TextVariants,
    Toolbar, ToolbarContent, ToolbarItem
} from '@patternfly/react-core';
import * as timeformat from "timeformat.js";
import { EmptyStatePanel } from 'cockpit-components-empty-state.jsx';
import { ListingTable } from 'cockpit-components-table.jsx';
import { SearchIcon } from '@patternfly/react-icons';
import { SortByDirection } from "@patternfly/react-table";
import { account_create_dialog } from "./account-create-dialog.js";
import { delete_account_dialog } from "./delete-account-dialog.js";
import { lockAccountDialog } from "./lock-account-dialog.js";
import { logoutAccountDialog } from "./logout-account-dialog.js";

const _ = cockpit.gettext;

const UserActions = ({ account }) => {
    const [isKebabOpen, setKebabOpen] = useState(false);

    const actions = [
        <DropdownItem key="edit-user"
                      onClick={ev => { ev.preventDefault(); cockpit.location.go(account.name) }}>
            {_("Edit user")}
        </DropdownItem>,
    ];

    superuser.allowed && actions.push(
        <DropdownSeparator key="separator-0" />,
        <DropdownItem key="log-user-out"
                      isDisabled={account.uid === 0 || !account.loggedIn}
                      onClick={() => { setKebabOpen(false); logoutAccountDialog(account) }}>
            {_("Log user out")}
        </DropdownItem>,
        <DropdownSeparator key="separator-1" />,
        <DropdownItem key="lock-account"
                      isDisabled={account.isLocked}
                      onClick={() => { setKebabOpen(false); lockAccountDialog(account) }}>
            {_("Lock account")}
        </DropdownItem>,
        <DropdownItem key="delete-account"
                      isDisabled={account.uid === 0}
                      className={account.uid === 0 ? "" : "delete-account-red"}
                      onClick={() => { setKebabOpen(false); delete_account_dialog(account) }}>
            {_("Delete account")}
        </DropdownItem>,
    );

    const kebab = (
        <Dropdown toggle={<KebabToggle onToggle={setKebabOpen} />}
                isPlain
                isOpen={isKebabOpen}
                position="right"
                dropdownItems={actions} />
    );
    return kebab;
};

const getAccountRow = (account, current, groups) => {
    const adminGroups = ['sudo', 'root', 'wheel'];

    const userGroups = groups.reduce((pV, group) => {
        if (group.userlist.find(accountName => accountName === account.name)) {
            const isAdmin = !!adminGroups.find(adm => adm === group.name);
            return pV.concat({ name: group.name, members: group.userlist.length, isAdmin: isAdmin });
        } else {
            return pV;
        }
    }, []);

    userGroups.sort((a, b) => {
        if (a.isAdmin)
            return -1;
        if (b.isAdmin)
            return 1;
        if (a.members === b.members)
            return a.name.localeCompare(b.name);
        else
            return b.members - a.members;
    });

    const userGroupLabels = userGroups.map(group => {
        const color = group.isAdmin ? "gold" : "cyan";
        return (
            <Label key={group.name} variant="filled" color={color}>
                {!group.isAdmin ? group.name : ("admin" + " (" + group.name + ")") }
            </Label>
        );
    });

    let loginText = "";
    let loginSortKey = null;
    if (account.loggedIn) {
        loginText = _("Logged in");
        loginSortKey = "logged in";
    } else if (!account.lastLogin) {
        loginText = _("Never logged in");
        loginSortKey = "never";
    } else {
        loginSortKey = new Date(account.lastLogin);
        loginText = timeformat.dateTime(loginSortKey);
    }

    const columns = [
        {
            title: (
                <span>
                    <a href={"#/" + account.name}>{account.name}</a>
                    {current && <Badge className="pf-u-ml-lg" id="current-account-badge">{_("Your account")}</Badge>}
                </span>
            ),
            sortKey: account.name,
            props: { width: 25, },
        },
        {
            title: account.gecos.split(',')[0],
            props: { width: 20, },
        },
        {
            title: account.uid.toString(),
            props: { width: 10, },
        },
        {
            title: loginText,
            sortKey: loginSortKey,
            props: { width: 25, },
        },
        {
            title: (
                <Flex spaceItems={{ default: 'spaceItemsSm' }}>
                    {userGroupLabels}
                </Flex>
            ),
            props: { width: 20 },
        },
        {
            title: <UserActions account={account} />,
            props: { className: "pf-c-table__action" }
        },
    ];

    return { columns };
};

const mapGroupsToAccount = (accounts, groups) => {
    return accounts.map(account => {
        const accountGroups = [];
        groups.forEach(group => {
            if (group.userlist.find(accountName => accountName === account.name))
                accountGroups.push(group.name);
        });
        account.groups = accountGroups;

        return account;
    });
};

const AccountsList = ({ accountsInfo, current_user, groups }) => {
    const [currentTextFilter, setCurrentTextFilter] = useState("");

    const accounts = mapGroupsToAccount(accountsInfo, groups);

    const filtered_accounts = accounts.filter(account => {
        if ((account.uid < 1000 && account.uid !== 0) ||
                 account.shell.match(/^(\/usr)?\/sbin\/nologin/) ||
                 account.shell === '/bin/false')
            return false;

        if (currentTextFilter !== "" &&
            (account.name.toLowerCase().indexOf(currentTextFilter.toLowerCase()) === -1) &&
            (account.gecos.toLowerCase().indexOf(currentTextFilter.toLowerCase()) === -1) &&
            (account.uid.toString().indexOf(currentTextFilter.toLowerCase()) === -1) &&
            (!account.groups.find(group => group.toLowerCase().indexOf(currentTextFilter.toLowerCase()) !== -1)))
            return false;

        return true;
    });

    const columns = [
        { title: _("Username"), sortable: true },
        { title: _("Full name"), sortable: true },
        { title: _("ID"), sortable: true },
        { title: _("Last active"), sortable: true },
        { title: _("Group") },
    ];

    const sortRows = (rows, direction, idx) => {
        const sortedRows = rows.sort((a, b) => {
            const aitem = a.columns[idx];
            const bitem = b.columns[idx];
            const aname = a.columns[0];
            const bname = b.columns[0];

            // current user is always first
            if (aname.sortKey === current_user)
                return direction === SortByDirection.asc ? -1 : 1;
            if (bname.sortKey === current_user)
                return direction === SortByDirection.asc ? 1 : -1;
            // sorting last login
            if (idx === 3) {
                if (aitem.sortKey === "logged in")
                    return -1;
                if (bitem.sortKey === "logged in")
                    return 1;
                if (aitem.sortKey === "never")
                    return 1;
                if (bitem.sortKey === "never")
                    return -1;

                return bitem.sortKey - aitem.sortKey;
            }

            return ((typeof aitem == 'string' ? aitem : (aitem.sortKey || aitem.title)).localeCompare(typeof bitem == 'string' ? bitem : (bitem.sortKey || bitem.title)));
        });
        return direction === SortByDirection.asc ? sortedRows : sortedRows.reverse();
    };

    const tableToolbar = (
        <Toolbar>
            <ToolbarContent className="accounts-toolbar-header">
                <ToolbarItem>
                    <SearchInput id="accounts-filter"
                                 placeholder={_("Search for name, group or ID")}
                                 value={currentTextFilter}
                                 onChange={setCurrentTextFilter}
                                 onClear={() => setCurrentTextFilter('')} />
                </ToolbarItem>
                { superuser.allowed &&
                    <>
                        <ToolbarItem variant="separator" />
                        <ToolbarItem alignment={{ md: 'alignRight' }}>
                            <Button id="accounts-create" onClick={() => account_create_dialog(accounts)}>
                                {_("Create new account")}
                            </Button>
                        </ToolbarItem>
                    </>
                }
            </ToolbarContent>
        </Toolbar>
    );

    return (
        <Card className="ct-card">
            <CardHeader>
                <CardTitle>
                    <Text component={TextVariants.h2}>{_("Accounts")}</Text>
                </CardTitle>
                {tableToolbar}
            </CardHeader>
            {filtered_accounts.length === 0
                ? <EmptyStatePanel title={_("No matching results")} icon={SearchIcon} />
                : <ListingTable columns={columns}
                              id="accounts-list"
                              rows={ filtered_accounts.map(a => getAccountRow(a, current_user === a.name, groups)) }
                              sortMethod={sortRows}
                              variant="compact" sortBy={{ index: 0, direction: SortByDirection.asc }} />}
        </Card>

    );
};

export const AccountsMain = ({ accountsInfo, current_user, groups }) => {
    return (
        <Page id="accounts">
            <PageSection>
                <AccountsList accountsInfo={accountsInfo} current_user={current_user} groups={groups} />
            </PageSection>
        </Page>
    );
};
