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
import moment from "moment";
import { superuser } from "superuser";

import { Button } from '@patternfly/react-core';
import { show_unexpected_error } from "./dialog-utils.js";
import { delete_account_dialog } from "./delete-account-dialog.js";
import { account_expiration_dialog, password_expiration_dialog } from "./expiration-dialogs.js";
import { set_password_dialog, reset_password_dialog } from "./password-dialogs.js";
import { AccountRoles } from "./account-roles.js";
import { AuthorizedKeys } from "./authorized-keys-panel.js";

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
        data = data.split('\n')[1]; // throw away header
        if (data.length === 0) return null;
        data = data.split('   '); // get last column - separated by spaces

        if (data[data.length - 1].indexOf('**Never logged in**') > -1)
            return null;
        else
            return new Date(data[data.length - 1]);
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
                    password_expiration = cockpit.format(_("Require password change on $0"), moment(fields[1]).format('LL'));
                }
            } else if (fields[0] && fields[0].indexOf("Account expires") === 0) {
                if (fields[1].indexOf("never") === 0) {
                    account_expiration = _("Never lock account");
                } else {
                    account_date = new Date(fields[1] + " 12:00:00 UTC");
                    account_expiration = cockpit.format(_("Lock account on $0"), moment(fields[1]).format('LL'));
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
                    this.get_logged();
                })
                .catch(show_unexpected_error);
    }

    const account = accounts.find(acc => acc.name == user);

    if (!account) {
        return (
            <div id="account-failure" className="curtains-ct blank-slate-pf">
                <div className="blank-slate-pf-icon">
                    <i className="fa fa-exclamation-circle" />
                </div>
                <h1>{_("Account not available or cannot be edited.")}</h1>
                <ol className="breadcrumb">
                    <li>
                        <Button variant="link" onClick={() => cockpit.location.go("/")}>
                            {_("Back to Accounts")}
                        </Button>
                    </li>
                </ol>
            </div>);
    }

    if (!details)
        return null;

    const self_mod_allowed = (user == current_user || !!superuser.allowed);

    var title_name = account.gecos;
    if (title_name)
        title_name = title_name.split(',')[0];
    else
        title_name = account.name;

    var last_login;
    if (details.logged.currently)
        last_login = _("Logged In");
    else if (!details.logged.last)
        last_login = _("Never");
    else
        last_login = moment(details.logged.last).format('LLL');

    return (
        <div id="account" className="container-fluid">
            <ol className="breadcrumb">
                <li><Button variant="link" onClick={() => cockpit.location.go("/")}>{_("Accounts")}</Button></li>
                <li className="active">{title_name}</li>
            </ol>

            <div className="panel panel-default account-details" id="account-details">
                <div className="panel-heading">
                    { superuser.allowed &&
                    <div className="pull-right">
                        <Button variant="secondary" onClick={() => logout_account()} id="account-logout"
                          isDisabled={!details.logged.currently || account.uid == 0}>
                            {_("Terminate Session")}
                        </Button>
                        { "\n" }
                        <Button isDisabled={account.uid == 0} variant="danger" id="account-delete"
                              onClick={() => delete_account_dialog(account)}>
                            {_("Delete")}
                        </Button>
                    </div>
                    }
                    <span id="account-title">{title_name}</span>
                </div>
                <div className="panel-body">
                    <table className="info-table-ct">
                        <tbody>
                            <tr>
                                <th scope="row"><label htmlFor="account-real-name">{_("Full Name")}</label></th>
                                <td id="account-real-name-wrapper">
                                    { superuser.allowed
                                        ? <input id="account-real-name" className="form-control"
                                      disabled={committing_real_name || account.uid == 0}
                                 value={edited_real_name || account.gecos}
                                 onChange={event => set_edited_real_name(event.target.value)}
                                 onBlur={event => change_real_name(event)}
                                 onKeyPress={event => {
                                     if (event.key == "Enter") {
                                         event.target.blur();
                                     }
                                 }} />
                                        : <output id="account-real-name">{account.gecos}</output>
                                    }
                                </td>
                            </tr>
                            <tr>
                                <th scope="row"><label htmlFor="account-user-name">{_("User Name")}</label></th>
                                <td><output id="account-user-name">{account.name}</output></td>
                            </tr>
                            { account.uid !== 0 &&
                            <tr>
                                <th scope="row"><label>{_("Roles")}</label></th>
                                <td id="account-roles">
                                    <div id="account-change-roles-roles">
                                        <AccountRoles account={account} groups={groups}
                                            currently_logged_in={details.logged.currently} />
                                    </div>
                                </td>
                            </tr>
                            }
                            <tr>
                                <th scope="row"><label htmlFor="account-last-login">{_("Last Login")}</label></th>
                                <td><output id="account-last-login">{last_login}</output></td>
                            </tr>
                            <tr>
                                <th scope="row"><label htmlFor="account-locked">{_("Access")}</label></th>
                                <td>
                                    <div className="account-column-one">
                                        <div className="checkbox" data-container="body">
                                            <label>
                                                <input type="checkbox" id="account-locked"
                                   disabled={!superuser.allowed || edited_locked != null}
                                   checked={edited_locked != null ? edited_locked : details.locked}
                                   onChange={event => change_locked(event.target.checked)} />
                                                <span>{_("Lock Account")}</span>
                                            </label>
                                        </div>
                                    </div>
                                    <Button onClick={() => account_expiration_dialog(account, details.expiration.account_date)}
                                      isDisabled={!superuser.allowed} variant="link" id="account-expiration-button">
                                        {details.expiration.account_text}
                                    </Button>
                                </td>
                            </tr>
                            { self_mod_allowed &&
                            <tr>
                                <th scope="row"><label htmlFor="account-set-password">{_("Password")}</label></th>
                                <td>
                                    <div className="account-column-one">
                                        { self_mod_allowed &&
                                        <Button variant="secondary" id="account-set-password"
                                  onClick={() => set_password_dialog(account, current_user)}>
                                            {_("Set Password")}
                                        </Button>
                                        }
                                        { "\n" }
                                        { superuser.allowed &&
                                        <Button variant="secondary" id="password-reset-button"
                                          onClick={() => reset_password_dialog(account)}>
                                            {_("Force Change")}
                                        </Button>
                                        }
                                    </div>
                                    <Button onClick={() => password_expiration_dialog(account, details.expiration.password_days)}
                              isDisabled={!superuser.allowed} variant="link" id="password-expiration-button">
                                        {details.expiration.password_text}
                                    </Button>
                                </td>
                            </tr>
                            }
                        </tbody>
                    </table>
                </div>
            </div>
            <AuthorizedKeys name={account.name} home={account.home} allow_mods={self_mod_allowed} />
        </div>);
}
