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
import React, { useState, useEffect, useRef } from 'react';
import { superuser } from "superuser";

import { admins } from './local.js';
import {
    Button, Badge,
    Card, CardActions, CardExpandableContent, CardHeader, CardTitle,
    Dropdown, DropdownItem, DropdownSeparator,
    Flex, FlexItem,
    HelperText, HelperTextItem,
    KebabToggle, Label,
    Page, PageSection,
    SearchInput, Stack,
    Text, TextContent, TextVariants,
    Toolbar, ToolbarContent, ToolbarItem
} from '@patternfly/react-core';
import * as timeformat from "timeformat.js";
import { EmptyStatePanel } from 'cockpit-components-empty-state.jsx';
import { ListingTable } from 'cockpit-components-table.jsx';
import { SearchIcon } from '@patternfly/react-icons';
import { SortByDirection } from "@patternfly/react-table";
import { account_create_dialog } from "./account-create-dialog.js";
import { delete_account_dialog } from "./delete-account-dialog.js";
import { delete_group_dialog } from "./delete-group-dialog.js";
import { group_create_dialog } from "./group-create-dialog.js";
import { lockAccountDialog } from "./lock-account-dialog.js";
import { logoutAccountDialog } from "./logout-account-dialog.js";

import { usePageLocation } from "hooks";

const _ = cockpit.gettext;

const GroupActions = ({ group, accounts }) => {
    const [isKebabOpen, setKebabOpen] = useState(false);

    if (!superuser.allowed)
        return null;

    const actions = [
        <DropdownItem key="delete-group"
                      className={group.uid === 0 ? "" : "delete-resource-red"}
                      onClick={() => { setKebabOpen(false); delete_group_dialog(group) }}>
            {_("Delete group")}
        </DropdownItem>,
    ];

    const kebab = (
        <Dropdown toggle={<KebabToggle onToggle={setKebabOpen} />}
                isPlain
                isOpen={isKebabOpen}
                position="right"
                dropdownItems={actions} />
    );
    return kebab;
};

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
                      className={account.uid === 0 ? "" : "delete-resource-red"}
                      onClick={() => { setKebabOpen(false); delete_account_dialog(account) }}>
            {_("Delete account")}
        </DropdownItem>,
    );

    const kebab = (
        <Dropdown toggle={<KebabToggle onToggle={setKebabOpen} />}
                isPlain
                isOpen={isKebabOpen}
                position="right"
                id="accounts-actions"
                menuAppendTo={document.body}
                dropdownItems={actions} />
    );
    return kebab;
};

const getGroupRow = (group, accounts) => {
    let groupColorClass;
    if (group.isAdmin)
        groupColorClass = "group-gold";
    else if (group.members > 0)
        groupColorClass = "group-cyan";
    else
        groupColorClass = "group-grey";

    const columns = [
        {
            sortKey: group.name,
            title: <Flex alignItems={{ default: 'alignItemsCenter' }}><div className={"dot " + groupColorClass} /><FlexItem>{group.name}</FlexItem></Flex>,
            props: { width: 20, },
        },
        {
            title: group.gid,
            props: { width: 10, },
        },
        {
            title: group.members,
            props: { width: 10, },
        },
        {
            title: (
                <TextContent>
                    <Text component={TextVariants.p}>
                        {(group.userlistPrimary.concat(group.userlist))
                                .map(account => {
                                    if (accounts.map(account => account.name).includes(account))
                                        return <Text key={account} component={TextVariants.a} href={"#" + account}>{account}</Text>;
                                    else
                                        return account;
                                })
                                .reduce((acc, curr) => [...acc, ", ", curr], [])
                                .slice(1)}
                    </Text>
                </TextContent>
            ),
            props: { width: 60, },
        },
        {
            title: <GroupActions group={group} accounts={accounts} />,
            props: { className: "pf-c-table__action" }
        },
    ];

    return { columns, props: { key: group.gid } };
};

const getAccountRow = (account, current, groups) => {
    const userGroups = groups.filter(group => group.gid === account.gid || group.userlist.find(accountName => accountName === account.name));
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
            title: account.uid,
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

    return { columns, props: { key: account.uid } };
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

const GroupsList = ({ groups, accounts, isExpanded, setIsExpanded }) => {
    const { options } = usePageLocation();
    const [currentTextFilter, setCurrentTextFilter] = useState(options.group || '');
    const columns = [
        { title: _("Group name"), sortable: true },
        { title: _("ID"), sortable: true },
        { title: _("# of users"), sortable: true },
        { title: _("Accounts") },
    ];
    const filtered_groups = groups.filter(group => {
        if (currentTextFilter !== "" &&
            (group.name.toLowerCase().indexOf(currentTextFilter.toLowerCase()) === -1) &&
            (group.gid.toString().indexOf(currentTextFilter.toLowerCase()) === -1))
            return false;

        return true;
    });
    const ref = useRef();

    useEffect(() => {
        if (ref.current != currentTextFilter) {
            ref.current = currentTextFilter;
            const newOptions = { ...options };
            if (currentTextFilter) {
                newOptions.group = currentTextFilter;
            } else {
                delete newOptions.group;
            }
            cockpit.location.go([], newOptions);
        } else {
            setCurrentTextFilter(options.group || "");
        }
    }, [currentTextFilter, options]);

    const sortRows = (rows, direction, idx) => {
        // GID and members columns are numeric
        const isNumeric = idx == 1 || idx == 2;
        const sortedRows = rows.sort((a, b) => {
            const aitem = a.columns[idx].sortKey || a.columns[idx].title;
            const bitem = b.columns[idx].sortKey || b.columns[idx].title;
            const aname = a.columns[0].sortKey;
            const bname = b.columns[0].sortKey;

            // administrator groups are always first
            if (admins.includes(aname))
                return direction === SortByDirection.asc ? -1 : 1;
            if (admins.includes(bname))
                return direction === SortByDirection.asc ? 1 : -1;

            if (isNumeric)
                return bitem - aitem;
            else
                return aitem.localeCompare(bitem);
        });
        return direction === SortByDirection.asc ? sortedRows : sortedRows.reverse();
    };

    const tableToolbar = (
        <Toolbar>
            <ToolbarContent className="groups-toolbar-header">
                {isExpanded && <ToolbarItem>
                    <SearchInput id="groups-filter"
                                 placeholder={_("Search for name or ID")}
                                 value={currentTextFilter}
                                 onChange={(_, val) => setCurrentTextFilter(val)}
                                 onClear={() => setCurrentTextFilter('')} />
                </ToolbarItem>}
                { superuser.allowed &&
                    <>
                        {isExpanded && <ToolbarItem variant="separator" />}
                        <ToolbarItem alignment={{ md: 'alignRight' }}>
                            <Button variant="secondary" id="groups-create" onClick={() => group_create_dialog(groups, setIsExpanded)}>
                                {_("Create new group")}
                            </Button>
                        </ToolbarItem>
                    </>
                }
            </ToolbarContent>
        </Toolbar>
    );

    return (
        <Card className="ct-card" isExpanded={isExpanded}>
            <CardHeader
                className="ct-card-expandable-header"
                onExpand={() => setIsExpanded(!isExpanded)}
                toggleButtonProps={{
                    id: 'groups-view-toggle',
                    'aria-label': _("Groups"),
                    'aria-expanded': isExpanded
                }}>
                <CardTitle className="pf-l-flex pf-m-space-items-sm pf-m-align-items-center">
                    <Text component={TextVariants.h2}>{_("Groups")}</Text>
                    {(!isExpanded && !groups.length) && <HelperText> <HelperTextItem variant="indeterminate">{_("Loading...")}</HelperTextItem></HelperText>}
                    {(!isExpanded && filtered_groups.length > 0) && <>
                        {filtered_groups.slice(0, 3)
                                .map(group => {
                                    const color = group.isAdmin ? "gold" : "cyan";
                                    return (
                                        <Label key={group.name} variant="filled" color={color}>
                                            {group.name + ": " + (group.userlistPrimary.length + group.userlist.length)}
                                        </Label>
                                    );
                                })}
                        {filtered_groups.length > 3 && <Button key="more" className="group-more-btn" isInline variant='link' onClick={() => setIsExpanded(!isExpanded)}>
                            {cockpit.format(_("$0 more..."), filtered_groups.length - 3)}
                        </Button>}
                    </>}
                </CardTitle>
                <CardActions>
                    {tableToolbar}
                </CardActions>
            </CardHeader>
            <CardExpandableContent>
                <ListingTable columns={columns}
                    id="groups-list"
                    rows={ filtered_groups.map(a => getGroupRow(a, accounts)) }
                    loading={ groups.length && accounts.length ? '' : _("Loading...") }
                    sortMethod={sortRows}
                    emptyComponent={<EmptyStatePanel title={_("No matching results")} icon={SearchIcon} />}
                    variant="compact" sortBy={{ index: 2, direction: SortByDirection.asc }} />
            </CardExpandableContent>
        </Card>
    );
};

const AccountsList = ({ accounts, current_user, groups }) => {
    const { options } = usePageLocation();
    const [currentTextFilter, setCurrentTextFilter] = useState(options.user || '');
    const filtered_accounts = accounts.filter(account => {
        if (currentTextFilter !== "" &&
            (account.name.toLowerCase().indexOf(currentTextFilter.toLowerCase()) === -1) &&
            (account.gecos.toLowerCase().indexOf(currentTextFilter.toLowerCase()) === -1) &&
            (account.uid.toString().indexOf(currentTextFilter.toLowerCase()) === -1) &&
            (!account.groups.find(group => group.toLowerCase().indexOf(currentTextFilter.toLowerCase()) !== -1)))
            return false;

        return true;
    });
    const ref = useRef();

    useEffect(() => {
        if (ref.current != currentTextFilter) {
            ref.current = currentTextFilter;
            const newOptions = { ...options };
            if (currentTextFilter) {
                newOptions.user = currentTextFilter;
            } else {
                delete newOptions.user;
            }
            cockpit.location.go([], newOptions);
        } else {
            setCurrentTextFilter(options.user || "");
        }
    }, [currentTextFilter, options]);

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

            if (idx == 2)
                return bitem.title - aitem.title;
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
                                 onChange={(_, val) => setCurrentTextFilter(val)}
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
            <ListingTable columns={columns}
                          id="accounts-list"
                          isEmptyStateInTable={currentTextFilter !== "" && filtered_accounts.length !== accounts.length}
                          rows={ filtered_accounts.map(a => getAccountRow(a, current_user === a.name, groups)) }
                          loading={ accounts.length ? '' : _("Loading...") }
                          sortMethod={sortRows}
                          emptyComponent={<EmptyStatePanel title={_("No matching results")} icon={SearchIcon} />}
                          variant="compact" sortBy={{ index: 0, direction: SortByDirection.asc }} />
        </Card>

    );
};

export const AccountsMain = ({ accountsInfo, current_user, groups, isGroupsExpanded, setIsGroupsExpanded }) => {
    const accounts = mapGroupsToAccount(accountsInfo, groups).filter(account => {
        if ((account.uid < 1000 && account.uid !== 0) ||
                 account.shell.match(/^(\/usr)?\/sbin\/nologin/) ||
                 account.shell === '/bin/false')
            return false;
        return true;
    });

    return (
        <Page id="accounts">
            <PageSection>
                <Stack hasGutter>
                    <GroupsList accounts={accounts} groups={groups} isExpanded={isGroupsExpanded} setIsExpanded={setIsGroupsExpanded} />
                    <AccountsList accounts={accounts} current_user={current_user} groups={groups} />
                </Stack>
            </PageSection>
        </Page>
    );
};
