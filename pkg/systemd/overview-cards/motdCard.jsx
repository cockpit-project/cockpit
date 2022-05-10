/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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

import React, { useState } from 'react';

import { Alert, AlertActionCloseButton, Button, Modal, TextArea } from '@patternfly/react-core';
import { EditIcon } from '@patternfly/react-icons';
import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { superuser } from "superuser";
import { useDialogs } from "dialogs.jsx";
import { useInit } from "hooks";

import cockpit from "cockpit";

import './motdCard.scss';

const _ = cockpit.gettext;

const MotdEditDialog = ({ text }) => {
    const Dialogs = useDialogs();
    const [value, setValue] = useState(text);
    const [error, setError] = useState(null);
    const [errorDetail, setErrorDetail] = useState(null);

    return (
        <Modal position="top"
               variant="medium" isOpen
               id="motd-box-edit-modal"
               onClose={Dialogs.close}
               title={_("Edit /etc/motd")}
               footer={
                   <>
                       {error &&
                       <ModalError dialogError={error}
                                    dialogErrorDetail={errorDetail} />}
                       <Button variant='primary'
                               onClick={() => cockpit.file("/etc/motd", { superuser: "try", err: "message" })
                                       .replace(value)
                                       .done(Dialogs.close)
                                       .fail(exc => {
                                           setError(_("Failed to save changes in /etc/motd"));
                                           setErrorDetail(exc.message);
                                       })}>
                           {_("Save changes")}
                       </Button>
                       <Button variant='link'
                               onClick={() => this.setState({ motdEditMode: false })}>
                           {_("Cancel")}
                       </Button>
                   </>
               }>
            <TextArea resizeOrientation="vertical"
                      value={value}
                      onChange={setValue} />
        </Modal>);
};

export const MotdCard = () => {
    const Dialogs = useDialogs();
    const [motdText, setMotdText] = useState("");
    const [motdVisible, setMotdVisible] = useState(false);

    useInit(() => {
        cockpit.file("/etc/motd").watch(content => {
            /* trim initial empty lines and trailing space, but keep initial spaces to not break ASCII art */
            if (content)
                content = content.trimRight().replace(/^\s*\n/, '');
            if (content && content != cockpit.localStorage.getItem('dismissed-motd')) {
                setMotdText(content);
                setMotdVisible(true);
            } else {
                setMotdVisible(false);
            }
        });
    });

    function hideAlert() {
        setMotdVisible(false);
        cockpit.localStorage.setItem('dismissed-motd', motdText);
    }

    if (!motdVisible)
        return null;

    const actionClose = <>
        {superuser.allowed &&
        <Button variant="plain"
                                     id="motd-box-edit"
                                     onClick={() => Dialogs.show(<MotdEditDialog text={motdText} />)}
                                     aria-label={_("Edit motd")}>
            <EditIcon />
        </Button>}
        <AlertActionCloseButton onClose={hideAlert} />
    </>;

    return <Alert id="motd-box" isInline variant="default" className="motd-box"
                  title={<pre id="motd">{motdText}</pre>}
                  actionClose={actionClose} />;
};
