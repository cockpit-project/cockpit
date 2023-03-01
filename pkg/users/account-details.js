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
import { apply_modal_dialog } from "cockpit-components-dialog.jsx";

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { Card, CardActions, CardBody, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { EmptyState, EmptyStateIcon, EmptyStateSecondaryActions, EmptyStateVariant } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { HelperText, HelperTextItem } from "@patternfly/react-core/dist/esm/components/HelperText/index.js";
import { Label } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { LabelGroup } from "@patternfly/react-core/dist/esm/components/LabelGroup/index.js";
import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Gallery } from "@patternfly/react-core/dist/esm/layouts/Gallery/index.js";
import { Select, SelectOption, SelectVariant } from "@patternfly/react-core/dist/esm/components/Select/index.js";
import { Text, TextVariants } from "@patternfly/react-core/dist/esm/components/Text/index.js";
import { Breadcrumb, BreadcrumbItem } from "@patternfly/react-core/dist/esm/components/Breadcrumb/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { Popover } from "@patternfly/react-core/dist/esm/components/Popover/index.js";
import { ExclamationCircleIcon, HelpIcon, UndoIcon } from '@patternfly/react-icons';
import { show_unexpected_error } from "./dialog-utils.js";
import { delete_account_dialog } from "./delete-account-dialog.js";
import { account_expiration_dialog, password_expiration_dialog } from "./expiration-dialogs.js";
import { set_password_dialog, reset_password_dialog } from "./password-dialogs.js";
import { AccountLogs } from "./account-logs-panel.jsx";
import { AuthorizedKeys } from "./authorized-keys-panel.js";
import * as timeformat from "timeformat.js";

const _ = cockpit.gettext;

function get_locked(name) {
    return cockpit.spawn(["passwd", "-S", name], { environ: ["LC_ALL=C"], superuser: "require" })
            .catch(() => "")
            .then(content => {
                const status = content.split(" ")[1];
                // libuser uses "LK", shadow-utils use "L".
                return status && (status == "LK" || status == "L");
            });
}

function get_expire(name) {
    function parse_expire(data) {
        let account_expiration = '';
        let account_date = null;

        let password_expiration = '';
        let password_days = null;

        data.split('\n').forEach(line => {
            const fields = line.split(': ');
            if (fields[0] && fields[0].indexOf("Password expires") === 0) {
                if (fields[1].indexOf("never") === 0) {
                    password_expiration = _("Never expire password");
                } else if (fields[1].indexOf("password must be changed") === 0) {
                    password_expiration = _("Password must be changed");
                } else {
                    password_expiration = cockpit.format(_("Require password change on $0"), timeformat.date(new Date(fields[1])));
                }
            } else if (fields[0] && fields[0].indexOf("Account expires") === 0) {
                if (fields[1].indexOf("never") === 0) {
                    account_expiration = _("Never expire account");
                } else {
                    account_date = new Date(fields[1] + " 12:00:00 UTC");
                    account_expiration = cockpit.format(_("Expire account on $0"), timeformat.date(new Date(fields[1])));
                }
            } else if (fields[0] && fields[0].indexOf("Maximum number of days between password change") === 0) {
                password_days = fields[1];
            }
        });

        return {
            account_text: account_expiration,
            account_date,
            password_text: password_expiration,
            password_days
        };
    }

    return cockpit.spawn(["chage", "-l", name],
                         { environ: ["LC_ALL=C"], err: "message", superuser: "try" })
            .catch(() => "")
            .then(parse_expire);
}

export function AccountDetails({ accounts, groups, shadow, current_user, user }) {
    const [expiration, setExpiration] = useState(null);
    useEffect(() => {
        get_expire(user).then(setExpiration);

        // Watch `/var/run/utmp` to register when user logs in or out
        const handle = cockpit.file("/var/run/utmp", { superuser: "try", binary: true });
        handle.watch(() => {
            get_expire(user).then(setExpiration);
        });
        return handle.close;
    }, [user, accounts, shadow]);

    const [edited_real_name, set_edited_real_name] = useState(null);
    const [committing_real_name, set_committing_real_name] = useState(false);

    const [edited_locked, set_edited_locked] = useState(null);

    function change_real_name() {
        if (!edited_real_name)
            return;

        set_committing_real_name(true);

        // TODO: unwanted chars check
        cockpit.spawn(["/usr/sbin/usermod", user, "--comment", edited_real_name],
                      { superuser: "try", err: "message" })
                .then(() => {
                    set_edited_real_name(null);
                    set_committing_real_name(false);
                })
                .catch(error => {
                    set_edited_real_name(null);
                    set_committing_real_name(false);
                    show_unexpected_error(error);
                });
    }

    function change_locked(value, dont_retry_if_stuck) {
        set_edited_locked(value);

        cockpit.spawn(["/usr/sbin/usermod", user, value ? "--lock" : "--unlock"],
                      { superuser: "require", err: "message" })
                .then(() => {
                    get_locked(user)
                            .then(locked => {
                            /* if we care about what the lock state should be and it doesn't match, try to change again
                               this is a workaround for different ways of handling a locked account
                               https://github.com/cockpit-project/cockpit/issues/1216
                               https://bugzilla.redhat.com/show_bug.cgi?id=853153
                               This seems to be fixed in fedora 23 (usermod catches the different locking behavior)
                            */
                                if (locked != value && !dont_retry_if_stuck) {
                                    console.log("Account locked state doesn't match desired value, trying again.");
                                    // only retry once to avoid uncontrolled recursion
                                    change_locked(value, true);
                                } else
                                    set_edited_locked(null);
                            });
                })
                .catch(error => {
                    set_edited_locked(null);
                    show_unexpected_error(error);
                });
    }

    function logout_account() {
        cockpit.spawn(["loginctl", "terminate-user", user],
                      { superuser: "try", err: "message" })
                .then(() => {
                    get_expire(user).then(setExpiration);
                })
                .catch(show_unexpected_error);
    }

    if (!accounts.length) {
        return (
            <EmptyState variant={EmptyStateVariant.small}>
                <Spinner isSVG size="xl" />
                <Title headingLevel="h1" size="lg">
                    {_("Loading...")}
                </Title>
            </EmptyState>
        );
    }

    const account = accounts.find(acc => acc.name == user);

    if (!account) {
        return (
            <EmptyState variant={EmptyStateVariant.small} id="account-failure">
                <EmptyStateIcon icon={ExclamationCircleIcon} />
                <Title headingLevel="h1" size="lg">
                    {_("Account not available or cannot be edited.")}
                </Title>
                <EmptyStateSecondaryActions>
                    <Breadcrumb>
                        <BreadcrumbItem to="#/">{_("Back to accounts")}</BreadcrumbItem>
                    </Breadcrumb>
                </EmptyStateSecondaryActions>
            </EmptyState>
        );
    }

    if (!expiration)
        return null;

    const self_mod_allowed = (user == current_user || !!superuser.allowed);

    let title_name = account.gecos;
    if (title_name)
        title_name = title_name.split(',')[0];
    else
        title_name = account.name;

    let last_login;
    if (account.loggedIn)
        last_login = _("Logged in");
    else if (!account.lastLogin)
        last_login = _("Never");
    else
        last_login = timeformat.dateTime(new Date(account.lastLogin));

    return (
        <Page groupProps={{ sticky: 'top' }}
              isBreadcrumbGrouped
              id="account"
              breadcrumb={
                  <Breadcrumb>
                      <BreadcrumbItem to="#/">{_("Accounts")}</BreadcrumbItem>
                      <BreadcrumbItem isActive>{title_name}</BreadcrumbItem>
                  </Breadcrumb>}>
            <PageSection>
                <Gallery hasGutter>
                    <Card className="account-details" id="account-details">
                        <CardHeader>
                            <CardTitle id="account-title"><Text component={TextVariants.h2}>{title_name}</Text></CardTitle>
                            { superuser.allowed &&
                            <CardActions>
                                <Button variant="secondary" onClick={() => logout_account()} id="account-logout"
                                  isDisabled={!account.loggedIn || account.uid == 0}>
                                    {_("Terminate session")}
                                </Button>
                                { "\n" }
                                <Button isDisabled={account.uid == 0} variant="danger" id="account-delete"
                                      onClick={() => delete_account_dialog(account)}>
                                    {_("Delete")}
                                </Button>
                            </CardActions>
                            }
                        </CardHeader>
                        <CardBody>
                            <Form isHorizontal onSubmit={apply_modal_dialog}>
                                <FormGroup fieldId="account-real-name" hasNoPaddingTop={!superuser.allowed} label={_("Full name")}>
                                    { superuser.allowed
                                        ? <TextInput id="account-real-name"
                                                     isDisabled={committing_real_name || account.uid == 0}
                                                     value={edited_real_name !== null ? edited_real_name : account.gecos}
                                                     onKeyPress={event => {
                                                         if (event.key == "Enter") {
                                                             event.target.blur();
                                                         }
                                                     }}
                                                     onChange={value => set_edited_real_name(value)}
                                                     onBlur={() => change_real_name()} />
                                        : <output id="account-real-name">{account.gecos}</output>}
                                </FormGroup>
                                <FormGroup fieldId="account-user-name" hasNoPaddingTop label={_("User name")}>
                                    <output id="account-user-name">{account.name}</output>
                                </FormGroup>
                                <AccountGroupsSelect key={account.name} loggedIn={account.loggedIn} name={account.name} groups={groups} />
                                <FormGroup fieldId="account-last-login" hasNoPaddingTop label={_("Last login")}>
                                    <output id="account-last-login">{last_login}</output>
                                </FormGroup>
                                <FormGroup fieldId="account-locked" label={_("Options")} hasNoPaddingTop>
                                    <div>
                                        <div className="account-column-one">
                                            <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
                                                <Checkbox id="account-locked"
                                                          isDisabled={!superuser.allowed || edited_locked != null || user == current_user}
                                                          isChecked={edited_locked != null ? edited_locked : account.isLocked}
                                                          onChange={checked => change_locked(checked)}
                                                          label={_("Disallow interactive password")} />

                                                <Popover bodyContent={_("Other authentication methods are still available even when interactive password authentication is not allowed.")}
                                                         showClose={false}>
                                                    <HelpIcon />
                                                </Popover>
                                            </Flex>
                                        </div>
                                        <Flex flex={{ default: 'inlineFlex' }}>
                                            <span id="account-expiration-text">
                                                {expiration.account_text}
                                            </span>
                                            <Button onClick={() => account_expiration_dialog(account, expiration.account_date)}
                                                    isDisabled={!superuser.allowed}
                                                    variant="link"
                                                    isInline
                                                    id="account-expiration-button">
                                                {_("edit")}
                                            </Button>
                                        </Flex>
                                    </div>
                                </FormGroup>
                                { self_mod_allowed &&
                                <FormGroup fieldId="account-set-password" label={_("Password")}>
                                    <div>
                                        <div className="account-column-one">
                                            { self_mod_allowed &&
                                            <Button variant="secondary" id="account-set-password"
                                      onClick={() => set_password_dialog(account, current_user)}>
                                                {_("Set password")}
                                            </Button>
                                            }
                                            { "\n" }
                                            { superuser.allowed &&
                                            <Button variant="secondary" id="password-reset-button"
                                              onClick={() => reset_password_dialog(account)}>
                                                {_("Force change")}
                                            </Button>
                                            }
                                        </div>
                                        <Flex flex={{ default: 'inlineFlex' }}>
                                            <span id="password-expiration-text">
                                                {expiration.password_text}
                                            </span>
                                            <Button onClick={() => password_expiration_dialog(account, expiration.password_days)}
                                                    isDisabled={!superuser.allowed}
                                                    variant="link"
                                                    isInline
                                                    id="password-expiration-button">
                                                {_("edit")}
                                            </Button>
                                        </Flex>
                                    </div>
                                </FormGroup>
                                }
                            </Form>
                        </CardBody>
                    </Card>
                    <AuthorizedKeys name={account.name} home={account.home} allow_mods={self_mod_allowed} />
                    <AccountLogs name={account.name} />
                </Gallery>
            </PageSection>
        </Page>
    );
}

export const AccountGroupsSelect = ({ name, loggedIn, groups, setError }) => {
    const [isOpenGroup, setIsOpenGroup] = useState(false);
    const [selected, setSelected] = useState();
    const [primaryGroupName, setPrimaryGroupName] = useState();
    const [loading, setLoading] = useState(true);
    const [history, setHistory] = useState([]);
    const previousValue = useRef(null);

    useEffect(() => {
        const usedGroups = groups.filter(group => group.userlist.includes(name));
        const primaryGroup = groups.find(group => group.userlistPrimary.includes(name));
        const _primaryGroupName = primaryGroup ? primaryGroup.name : undefined;
        const _selected = usedGroups.map(group => group.name);
        if (primaryGroup)
            _selected.push(_primaryGroupName);

        previousValue.current = _selected;
        setSelected(_selected);
        setLoading(false);
        setPrimaryGroupName(_primaryGroupName);
    }, [groups, setSelected, name, previousValue]);

    const undoGroupChanges = () => {
        const undoItem = history[history.length - 1];
        if (undoItem.type === 'added') {
            removeGroup(undoItem.name, true).then(() => setHistory(history.slice(0, -1)));
        } else if (undoItem.type === 'removed') {
            addGroup(undoItem.name, true).then(() => setHistory(history.slice(0, -1)));
        }
    };

    const removeGroup = (group, isUndo) => {
        if (!isUndo)
            setHistory([...history, { type: 'removed', name: group }]);

        setLoading(true);
        return cockpit.spawn(["gpasswd", "-d", name, group], { superuser: "require", err: "message" })
                .then(() => {
                    setIsOpenGroup(false);
                }, show_unexpected_error);
    };

    const addGroup = (group, isUndo) => {
        if (!isUndo)
            setHistory([...history, { type: 'added', name: group }]);

        setLoading(true);
        return cockpit.spawn(["gpasswd", "-a", name, group], { superuser: "require", err: "message" })
                .then(() => {
                    setIsOpenGroup(false);
                }, show_unexpected_error);
    };

    const onSelectGroup = (event, selection) => {
        if (selected.includes(selection)) {
            removeGroup(selection);
        } else {
            addGroup(selection);
        }
    };

    const chipGroupComponent = () => {
        return (
            <LabelGroup numLabels={10}>
                {(selected || []).map((currentLabel, index) => {
                    const optional = currentLabel !== primaryGroupName && superuser.allowed
                        ? {
                            onClose: ev => {
                                ev.stopPropagation();
                                removeGroup(currentLabel);
                            }
                        }
                        : {};

                    return (
                        <Label key={currentLabel}
                               color={groups.find(group => group.name === currentLabel).isAdmin ? "gold" : "cyan"}
                               {...optional}
                        >
                            {currentLabel}
                        </Label>
                    );
                })}
            </LabelGroup>
        );
    };

    return (
        <FormGroup
            fieldId="account-groups"
            helperText={
                (history.length > 0)
                    ? <HelperText className="pf-c-form__helper-text">
                        <Flex>
                            {loggedIn && <HelperTextItem id="account-groups-helper" variant="warning">{_("The user must log out and log back in for the new configuration to take effect.")}</HelperTextItem>}
                            {history.length > 0 && <Button variant="link" id="group-undo-btn" isInline icon={<UndoIcon />} onClick={undoGroupChanges}>{_("Undo")}</Button>}
                        </Flex>
                    </HelperText>
                    : ''
            }
            id="account-groups-form-group"
            label={_("Groups")}
            validated={history.length > 0 ? "warning" : "default"}
        >
            {superuser.allowed
                ? <Select
                   chipGroupComponent={chipGroupComponent()}
                   isDisabled={!superuser.allowed || loading}
                   isOpen={isOpenGroup}
                   onSelect={onSelectGroup}
                   onToggle={setIsOpenGroup}
                   selections={selected}
                   toggleId="account-groups"
                   variant={SelectVariant.typeaheadMulti}
                >
                    {groups.map((option, index) => (
                        <SelectOption
                            isDisabled={option.name == primaryGroupName}
                            key={index}
                            value={option.name}
                        />
                    ))}
                </Select>
                : chipGroupComponent()}
        </FormGroup>
    );
};
