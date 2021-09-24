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
import React, { useState, useEffect } from 'react';
import { superuser } from "superuser";
import { apply_modal_dialog } from "cockpit-components-dialog.jsx";

import {
    Button, Checkbox,
    Card, CardBody, CardHeader, CardTitle, CardActions,
    EmptyState, EmptyStateVariant, EmptyStateIcon, EmptyStateSecondaryActions,
    Flex,
    Page, PageSection,
    Gallery, Text, TextVariants, Breadcrumb, BreadcrumbItem,
    Form, FormGroup, TextInput,
    Title,
} from '@patternfly/react-core';
import { ExclamationCircleIcon } from '@patternfly/react-icons';
import { show_unexpected_error } from "./dialog-utils.js";
import { delete_account_dialog } from "./delete-account-dialog.js";
import { account_expiration_dialog, password_expiration_dialog } from "./expiration-dialogs.js";
import { set_password_dialog, reset_password_dialog } from "./password-dialogs.js";
import { AccountRoles } from "./account-roles.js";
import { AccountLogs } from "./account-logs-panel.jsx";
import { AuthorizedKeys } from "./authorized-keys-panel.js";
import * as timeformat from "timeformat.js";

const _ = cockpit.gettext;

function log_unexpected_error(error) {
    console.warn("Unexpected error", error);
}

function get_locked(name) {
    return cockpit.spawn(["/usr/bin/passwd", "-S", name], { environ: ["LC_ALL=C"], superuser: "require" })
            .catch(() => "")
            .then(content => {
                const status = content.split(" ")[1];
                // libuser uses "LK", shadow-utils use "L".
                return status && (status == "LK" || status == "L");
            });
}

function get_logged(name) {
    return cockpit.spawn(["/usr/bin/w", "-sh", name])
            .then(content => content.length > 0 ? { currently: true } : get_last_login(name))
            .catch(log_unexpected_error);
}

function get_last_login(name) {
    function parse_last_login(data) {
        const line = data.split('\n')[1]; // throw away header
        if (!line || line.length === 0 || line.indexOf('**Never logged in**') > -1)
            return null;

        // line looks like this: admin            web cons ::ffff:172.27.0. Tue Mar 23 14:49:04 +0000 2021
        // or like this:         admin            web cons ::ffff:172.27.0. Thu Apr  1 08:58:51 +0000 2021
        const date_fields = line.split(/ +/).slice(-5);
        const d = new Date(date_fields.join(' '));
        if (d.getTime() > 0)
            return d;

        console.warn("Failed to parse date from lastlog line:", line);
        return null;
    }

    return cockpit.spawn(["/usr/bin/lastlog", "-u", name], { environ: ["LC_ALL=C"] })
            .then(data => ({ currently: false, last: parse_last_login(data) }))
            .catch(() => ({ currently: false, last: null }));
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
            account_date: account_date,
            password_text: password_expiration,
            password_days: password_days
        };
    }

    return cockpit.spawn(["/usr/bin/chage", "-l", name],
                         { environ: ["LC_ALL=C"], err: "message", superuser: "try" })
            .catch(() => "")
            .then(parse_expire);
}

function get_details(name) {
    return Promise.all([get_logged(name), get_locked(name), get_expire(name)]).then(values => {
        return {
            logged: values[0],
            locked: values[1],
            expiration: values[2]
        };
    });
}

export function AccountDetails({ accounts, groups, shadow, current_user, user }) {
    const [details, setDetails] = useState(null);
    useEffect(() => {
        get_details(user).then(setDetails);

        // Watch `/var/run/utmp` to register when user logs in or out
        const handle = cockpit.file("/var/run/utmp", { superuser: "try", binary: true });
        handle.watch(() => {
            get_details(user).then(setDetails);
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
        cockpit.spawn(["/usr/bin/loginctl", "terminate-user", user],
                      { superuser: "try", err: "message" })
                .then(() => {
                    get_details(user).then(setDetails);
                })
                .catch(show_unexpected_error);
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
                        <BreadcrumbItem onClick={() => cockpit.location.go("/")} to="#">{_("Back to accounts")}</BreadcrumbItem>
                    </Breadcrumb>
                </EmptyStateSecondaryActions>
            </EmptyState>
        );
    }

    if (!details)
        return null;

    const self_mod_allowed = (user == current_user || !!superuser.allowed);

    let title_name = account.gecos;
    if (title_name)
        title_name = title_name.split(',')[0];
    else
        title_name = account.name;

    let last_login;
    if (details.logged.currently)
        last_login = _("Logged in");
    else if (!details.logged.last)
        last_login = _("Never");
    else
        last_login = timeformat.dateTime(new Date(details.logged.last));

    return (
        <Page groupProps={{ sticky: 'top' }}
              isBreadcrumbGrouped
              id="account"
              breadcrumb={
                  <Breadcrumb>
                      <BreadcrumbItem onClick={() => cockpit.location.go("/")} to="#">{_("Accounts")}</BreadcrumbItem>
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
                                  isDisabled={!details.logged.currently || account.uid == 0}>
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
                                                     onBlur={event => change_real_name(event)} />
                                        : <output id="account-real-name">{account.gecos}</output>}
                                </FormGroup>
                                <FormGroup fieldId="account-user-name" hasNoPaddingTop label={_("User name")}>
                                    <output id="account-user-name">{account.name}</output>
                                </FormGroup>
                                { account.uid !== 0 &&
                                <FormGroup fieldId="account-roles" isInline label={_("Roles")}>
                                    <div id="account-roles">
                                        <div id="account-change-roles-roles">
                                            <AccountRoles account={account} groups={groups}
                                                currently_logged_in={details.logged.currently} />
                                        </div>
                                    </div>
                                </FormGroup>
                                }
                                <FormGroup fieldId="account-last-login" hasNoPaddingTop label={_("Last login")}>
                                    <output id="account-last-login">{last_login}</output>
                                </FormGroup>
                                <FormGroup fieldId="account-locked" label={_("Access")} hasNoPaddingTop>
                                    <div>
                                        <div className="account-column-one">
                                            <Checkbox id="account-locked"
                                                      isDisabled={!superuser.allowed || edited_locked != null || user == current_user}
                                                      isChecked={edited_locked != null ? edited_locked : details.locked}
                                                      label={_("Lock account")}
                                                      onChange={checked => change_locked(checked)} />
                                        </div>
                                        <Flex flex={{ default: 'inlineFlex' }}>
                                            <span id="account-expiration-text">
                                                {details.expiration.account_text}
                                            </span>
                                            <Button onClick={() => account_expiration_dialog(account, details.expiration.account_date)}
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
                                                {details.expiration.password_text}
                                            </span>
                                            <Button onClick={() => password_expiration_dialog(account, details.expiration.password_days)}
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
        </Page>);
}
