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

import cockpit from "cockpit";
import React, { useState } from "react";
import { useObject, useInit, useEvent } from "hooks";
import { useDialogs } from "dialogs.jsx";
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { Modal } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { host_superuser_storage_key } from './machines/machines';
import { LockIcon } from '@patternfly/react-icons';

const _ = cockpit.gettext;

function sudo_polish(msg) {
    if (!msg)
        return msg;

    msg = msg.replace(/^\[sudo] /, "");
    msg = msg[0].toUpperCase() + msg.slice(1);

    return msg;
}

const UnlockDialog = ({ proxy, host }) => {
    const D = useDialogs();
    useInit(init, [proxy, host]);

    const [methods, setMethods] = useState(null);
    const [method, setMethod] = useState(false);
    const [busy, setBusy] = useState(false);
    const [cancel, setCancel] = useState(null);
    const [prompt, setPrompt] = useState(null);
    const [message, setMessage] = useState(null);
    const [error, setError] = useState(null);
    const [errorVariant, setErrorVariant] = useState(null);
    const [value, setValue] = useState("");

    function start(method) {
        setBusy(true);
        setCancel(() => () => {
            proxy.Stop();
            D.close();
        });

        let did_prompt = false;

        const onprompt = (event, message, prompt, def, echo, error) => {
            setBusy(false);
            setPrompt({
                message: sudo_polish(message),
                prompt: sudo_polish(prompt),
                echo
            });
            setValue(def);

            if (error) {
                setError(sudo_polish(error));
                setErrorVariant(did_prompt ? 'danger' : 'warning');
            }

            did_prompt = true;
        };

        proxy.addEventListener("Prompt", onprompt);
        proxy.Start(method)
                .then(() => {
                    proxy.removeEventListener("Prompt", onprompt);

                    const key = host_superuser_storage_key(host);
                    if (key)
                        window.localStorage.setItem(key, method);
                    if (did_prompt) {
                        D.close();
                    } else {
                        setBusy(false);
                        setPrompt(null);
                        setMessage(_("You now have administrative access."));
                        setCancel(() => D.close);
                    }
                })
                .catch(err => {
                    console.warn(err);
                    proxy.removeEventListener("Prompt", onprompt);
                    if (err && err.message != "cancelled") {
                        setBusy(false);
                        setPrompt(null);
                        setError(sudo_polish(err.toString()));
                        setCancel(() => D.close);
                    } else
                        D.close();
                });
    }

    function init() {
        return proxy.Stop().finally(() => {
            if (proxy.Methods) {
                const ids = Object.keys(proxy.Methods);
                if (ids.length == 0)
                    start("sudo");
                else if (ids.length == 1)
                    start(ids[0]);
                else {
                    setMethods(ids);
                    setMethod(ids[0]);
                }
            } else
                start("sudo");
        });
    }

    const validated = errorVariant == "danger" ? "error" : errorVariant;

    let title = null;
    let title_icon = null;
    let body = null;
    let footer = null;

    if (prompt) {
        if (!prompt.message && !prompt.prompt) {
            prompt.message = _("Please authenticate to gain administrative access");
            prompt.prompt = _("Password");
        }

        const apply = () => {
            proxy.Answer(value);
            setError(null);
            setBusy(true);
        };

        title = _("Switch to administrative access");
        body = (
            <Form isHorizontal onSubmit={event => { apply(); event.preventDefault(); return false }}>
                { error && <Alert variant={errorVariant || 'danger'} isInline title={error} /> }
                { prompt.message && <span>{prompt.message}</span> }
                <FormGroup
                    fieldId="switch-to-admin-access-password"
                    label={prompt.prompt}
                    validated={!error ? "default" : validated || "error"}
                >
                    <TextInput
                        autoFocus // eslint-disable-line jsx-a11y/no-autofocus
                        id="switch-to-admin-access-password"
                        isDisabled={busy}
                        onChange={(_event, value) => setValue(value)}
                        type={!prompt.echo ? 'password' : 'text'}
                        validated={!error ? "default" : validated || "error"}
                        value={value}
                    />
                </FormGroup>
            </Form>
        );

        footer = (
            <>
                <Button variant='primary' onClick={apply} isDisabled={busy} isLoading={busy}>
                    {_("Authenticate")}
                </Button>
                <Button variant='link' className='btn-cancel' onClick={cancel} isDisabled={!cancel}>
                    {_("Cancel")}
                </Button>
            </>);
    } else if (message) {
        title = _("Administrative access");
        body = <p>{message}</p>;
        footer = (
            <Button variant="secondary" className='btn-cancel' onClick={cancel}>
                {_("Close")}
            </Button>);
    } else if (error) {
        title_icon = "danger";
        title = _("Problem becoming administrator");
        body = <p>{error}</p>;
        footer = (
            <Button variant="secondary" className='btn-cancel' onClick={cancel}>
                {_("Close")}
            </Button>);
    } else if (methods) {
        title = _("Switch to administrative access");
        body = (
            <Form isHorizontal>
                <FormGroup fieldId="switch-to-admin-access-bridge-select"
                           label={_("Method")}>
                    <FormSelect id="switch-to-admin-access-bridge-select" value={method} onChange={(_, method) => setMethod(method)} isDisabled={busy}>
                        { methods.map(m => <FormSelectOption value={m} key={m}
                                                             label={_(proxy.Methods[m].v.label.v)} />) }
                    </FormSelect>
                </FormGroup>
            </Form>);

        footer = (
            <>
                <Button variant='primary' onClick={() => start(method)} isDisabled={busy} isLoading={busy}>
                    {_("Authenticate")}
                </Button>
                <Button variant='link' className='btn-cancel' onClick={busy ? cancel : D.close}
                        isDisabled={busy && !cancel}>
                    {_("Cancel")}
                </Button>
            </>);
    }

    if (body === null)
        return null;

    return (
        <Modal isOpen
               position="top"
               variant="medium"
               onClose={D.close}
               title={title}
               titleIconVariant={title_icon}
               footer={footer}>
            {body}
        </Modal>
    );
};

const LockDialog = ({ proxy, host }) => {
    const D = useDialogs();
    const [error, setError] = useState(null);

    const apply = () => {
        setError(null);
        proxy.Stop()
                .then(() => {
                    const key = host_superuser_storage_key(host);
                    if (key)
                        window.localStorage.setItem(key, "none");
                    D.close();
                })
                .catch(err => {
                    setError(err.toString());
                });
    };

    const footer = (
        <>
            <Button variant='primary' onClick={apply}>
                {_("Limit access")}
            </Button>
            <Button variant='link' className='btn-cancel' onClick={D.close}>
                {_("Cancel")}
            </Button>
        </>
    );

    return (
        <Modal isOpen
               position="top" variant="medium"
               onClose={D.close}
               footer={footer}
               title={_("Switch to limited access")}>
            <Stack hasGutter>
                {error && <ModalError dialogError={error} />}
                <StackItem>
                    <p>{_("Limited access mode restricts administrative privileges. Some parts of the web console will have reduced functionality.")}</p>
                    <p>{_("Your browser will remember your access level across sessions.")}</p>
                </StackItem>
            </Stack>
        </Modal>
    );
};

const SuperuserDialogs = ({ superuser_proxy, host, create_trigger }) => {
    const D = useDialogs();
    useEvent(superuser_proxy, "changed",
             () => {
                 const key = host_superuser_storage_key(host);
                 if (key) {
                     // Reset wanted state if we fail to gain admin privs.
                     // Failing to gain admin privs might take a noticeable
                     // time, and we don't want to suffer through the
                     // associated intermediate UI state on every login.
                     const want = window.localStorage.getItem(key);
                     if (superuser_proxy.Current == "none" && superuser_proxy.Current != want)
                         window.localStorage.setItem(key, superuser_proxy.Current);
                 }
             });

    const show = superuser_proxy.Current != "root" && superuser_proxy.Current != "init";
    const unlocked = superuser_proxy.Current != "none";

    function unlock() {
        D.show(<UnlockDialog proxy={superuser_proxy} host={host} />);
    }

    function lock() {
        D.show(<LockDialog proxy={superuser_proxy} host={host} />);
    }

    if (!show || !superuser_proxy.Bridges || superuser_proxy.Bridges.length == 0)
        return null;

    return create_trigger(unlocked, unlocked ? lock : unlock);
};

export const SuperuserIndicator = ({ proxy, host }) => {
    function create_trigger(unlocked, onclick) {
        return (
            <Button variant="link" onClick={onclick} className={unlocked ? "ct-unlocked" : "ct-locked"}>
                <span className="ct-lock-wrapper">
                    {!unlocked && <LockIcon />}
                    {unlocked ? _("Administrative access") : _("Limited access")}
                </span>
            </Button>
        );
    }

    return <SuperuserDialogs superuser_proxy={proxy}
                             host={host}
                             create_trigger={create_trigger} />;
};

export const SuperuserButton = () => {
    const proxy = useObject(() => cockpit.dbus(null, { bus: "internal" }).proxy("cockpit.Superuser", "/superuser"));

    const create_trigger = (unlocked, onclick) =>
        <Button onClick={onclick}>
            {unlocked ? _("Switch to limited access") : _("Turn on administrative access")}
        </Button>;

    return <SuperuserDialogs superuser_proxy={proxy} create_trigger={create_trigger} />;
};
