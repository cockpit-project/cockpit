/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2021 Red Hat, Inc.
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

import cockpit from "cockpit";
import React, { useState, useEffect, useCallback } from 'react';

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Modal } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Popover } from "@patternfly/react-core/dist/esm/components/Popover/index.js";
import { Tooltip } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";
import { ExternalLinkSquareAltIcon, HelpIcon } from '@patternfly/react-icons';

import * as service from "service";
import { EmptyStatePanel } from 'cockpit-components-empty-state.jsx';
import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { ProfilesMenuDialogBody } from './profiles-menu-dialog-body.jsx';
import { superuser } from 'superuser';
import { useObject, useEvent } from "hooks";
import { useDialogs } from "dialogs.jsx";

const _ = cockpit.gettext;

export const TunedPerformanceProfile = () => {
    const Dialogs = useDialogs();
    const [btnText, setBtnText] = useState();
    const [state, setState] = useState();
    const [status, setStatus] = useState();

    const tunedService = useObject(() => service.proxy("tuned.service"),
                                   null,
                                   []);
    const tuned = useObject(() => cockpit.dbus("com.redhat.tuned", { superuser: "try" }),
                            obj => obj.close(),
                            [superuser.allowed, tunedService.state]);

    const poll = useCallback(() => {
        return Promise.all([
            tuned.call('/Tuned', 'com.redhat.tuned.control', 'is_running', []),
            tuned.call('/Tuned', 'com.redhat.tuned.control', 'active_profile', []),
            tuned.call('/Tuned', 'com.redhat.tuned.control', 'recommend_profile', [])
        ])
                .then(([[is_running], [active_result], [recommended]]) => {
                    const active = is_running ? active_result : "none";
                    return ({ state: "running", active, recommended });
                })
                .catch((ex) => {
                    if (!tunedService.exists)
                        return ({ state: "not-installed" });
                    else if (tunedService.state != "running")
                        return ({ state: "not-running" });
                    else
                        return Promise.reject(ex);
                });
    }, [tunedService, tuned]);

    const updateButton = useCallback(() => {
        return poll()
                .then(res => {
                    const { state, active, recommended } = res;
                    let status;

                    if (state == "not-installed")
                        status = _("Tuned is not available");
                    else if (state == "not-running")
                        status = _("Tuned is not running");
                    else if (active == "none")
                        status = _("Tuned is off");
                    else if (active == recommended)
                        status = _("This system is using the recommended profile");
                    else
                        status = _("This system is using a custom profile");

                    setBtnText(state == "running" ? active : _("none"));
                    setState(state);
                    setStatus(status);
                })
                .catch((ex) => {
                    console.warn("failed to poll tuned", ex);

                    setBtnText("error");
                    setStatus(_("Communication with tuned has failed"));
                });
    }, [poll, setBtnText, setState, setStatus]);

    useEvent(superuser, "changed");
    useEvent(tunedService, "changed", () => updateButton());

    useEffect(() => {
        updateButton();
    }, [updateButton]);

    const showDialog = () => {
        Dialogs.show(<TunedDialog updateButton={updateButton}
                                  poll={poll}
                                  tunedDbus={tuned} tunedService={tunedService} />);
    };

    return (
        <Tooltip id="tuned-status-tooltip" content={status}>
            <Button id="tuned-status-button"
                    isAriaDisabled={btnText == "error" || state == "not-installed" || !superuser.allowed}
                    isInline
                    onClick={showDialog}
                    variant='link'>
                {btnText}
            </Button>
        </Tooltip>
    );
};

const TunedDialog = ({
    updateButton,
    poll,
    tunedDbus,
    tunedService,
}) => {
    const Dialogs = useDialogs();
    const [activeProfile, setActiveProfile] = useState();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState();
    const [profiles, setProfiles] = useState([]);
    const [selected, setSelected] = useState();

    /* Tuned doesn't implement the DBus.Properties interface, so
     * we occasionally poll for what we need.
     *
     * Tuned doesn't auto-activate on the bus, so we have to start
     * it explicitly when opening the dialog.
     */

    const setProfile = () => {
        const setService = () => {
            /* When the profile is none we disable tuned */
            const enable = (selected != "none");
            const action = enable ? "start" : "stop";
            return tunedDbus.call('/Tuned', 'com.redhat.tuned.control', action, [])
                    .then(results => {
                    /* Yup this is how tuned returns failures */
                        if (!results[0]) {
                            console.warn("Failed to " + action + " tuned:", results);
                            if (results[1])
                                return Promise.reject(results[1]);
                            else if (enable)
                                return Promise.reject(cockpit.format(_("Failed to enable tuned")));
                            else
                                return Promise.reject(cockpit.format(_("Failed to disable tuned")));
                        }

                        /* Now tell systemd about this change */
                        if (enable && !tunedService.enabled)
                            return tunedService.enable();
                        else if (!enable && tunedService.enabled)
                            return tunedService.disable();
                        else
                            return null;
                    });
        };

        let promise;

        if (selected == "none") {
            promise = tunedDbus.call("/Tuned", 'com.redhat.tuned.control', 'disable', [])
                    .then(results => {
                    /* Yup this is how tuned returns failures */
                        if (!results[0]) {
                            console.warn("Failed to disable tuned profile:", results);
                            return Promise.reject(_("Failed to disable tuned profile"));
                        }

                        updateButton();
                    });
        } else {
            promise = tunedDbus.call('/Tuned', 'com.redhat.tuned.control', 'switch_profile', [selected])
                    .then(results => {
                        /* Yup this is how tuned returns failures */
                        if (!results[0][0]) {
                            console.warn("Failed to switch profile:", results);
                            return Promise.reject(results[0][1] || _("Failed to switch profile"));
                        }

                        updateButton();
                    });
        }

        return promise
                .then(setService)
                .then(Dialogs.close)
                .catch(setError);
    };

    useEffect(() => {
        const withInfo = (active, recommended, profiles) => {
            const model = [];
            profiles.forEach(p => {
                let name, desc;
                if (typeof p === "string") {
                    name = p;
                    desc = "";
                } else {
                    name = p[0];
                    desc = p[1];
                }
                if (name != "none") {
                    model.push({
                        name,
                        title: name,
                        description: desc,
                        active: name == active,
                        recommended: name == recommended,
                    });
                }
            });

            model.unshift({
                name: "none",
                title: _("None"),
                description: _("Disable tuned"),
                active: active == "none",
                recommended: recommended == "none",
            });

            setProfiles(model);
            setActiveProfile(active);
            setSelected(active);
        };

        const withTuned = () => {
            const tunedProfiles = () => {
                return tunedDbus.call('/Tuned', 'com.redhat.tuned.control', 'profiles2', [])
                        .then((result) => result[0])
                        .catch(ex => {
                            return tunedDbus.call('/Tuned', 'com.redhat.tuned.control', 'profiles', [])
                                    .then((result) => result[0]);
                        });
            };

            return poll()
                    .then(res => {
                        const { state, active, recommended } = res;
                        if (state != "running") {
                            setError(_("Tuned has failed to start"));
                            return;
                        }
                        return tunedProfiles()
                                .then(profiles => {
                                    return withInfo(active, recommended, profiles);
                                })
                                .catch(setError);
                    })
                    .catch(setError);
        };

        tunedService.start()
                .then(updateButton)
                .then(withTuned)
                .catch(setError)
                .finally(() => setLoading(false));
    }, [updateButton, poll, tunedService, tunedDbus]);

    const help = (
        <Popover
            id="tuned-help"
            bodyContent={
                <div>
                    {_("Tuned is a service that monitors your system and optimizes the performance under certain workloads. The core of Tuned are profiles, which tune your system for different use cases.")}
                </div>
            }
            footerContent={
                <Button component='a'
                        rel="noopener noreferrer" target="_blank"
                        variant='link'
                        isInline
                        icon={<ExternalLinkSquareAltIcon />} iconPosition="right"
                        href="https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/8/html-single/managing_systems_using_the_rhel_8_web_console/index#optimizing-the-system-performance-using-the-web-console_system-management-using-the-RHEL-8-web-console">
                    {_("Learn more")}
                </Button>
            }
        >
            <Button variant="plain" aria-label={_("Help")}>
                <HelpIcon />
            </Button>
        </Popover>
    );

    return (
        <Modal position="top" variant="medium"
               className="ct-m-stretch-body"
               isOpen
               help={help}
               onClose={Dialogs.close}
               title={_("Change performance profile")}
               footer={
                   <>
                       <Button variant='primary' isDisabled={!selected} onClick={setProfile}>
                           {_("Change profile")}
                       </Button>
                       <Button variant='link' onClick={Dialogs.close}>
                           {_("Cancel")}
                       </Button>
                   </>
               }
        >
            {error && <ModalError dialogError={typeof error == 'string' ? error : error.message} />}
            {loading && <EmptyStatePanel loading />}
            {activeProfile && <ProfilesMenuDialogBody active_profile={activeProfile}
                                               change_selected={setSelected}
                                               profiles={profiles} />}
        </Modal>
    );
};
