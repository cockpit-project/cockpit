/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2022 Red Hat, Inc.
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

/* DIALOG PRESENTATION PROTOCOL
 *
 * Example:
 *
 * import { WithDialogs, useDialogs } from "dialogs.jsx";
 *
 * const App = () =>
 *   <WithDialogs>
 *     <Page>
 *       <ExampleButton />
 *     </Page>
 *   </WithDialogs>;
 *
 * const ExampleButton = () => {
 *   const Dialogs = useDialogs();
 *   return <Button onClick={() => Dialogs.show(<MyDialog />)}>Open dialog</Button>;
 * };
 *
 * const MyDialog = () => {
 *   const Dialogs = useDialogs();
 *   return (
 *     <Modal title="My dialog"
 *            isOpen
 *            onClose={Dialogs.close}>
 *       <p>Hello!</p>
 *     </Modal>);
 * };
 *
 * This does two things: It maintains the state of whether the dialog
 * is open, and it does it high up in the DOM, in a stable place.
 * Even if ExampleButton is no longer part of the DOM, the dialog will
 * stay open and remain useable.
 */

import React, { useState, useContext } from "react";

export const DialogsContext = React.createContext();
export const useDialogs = () => useContext(DialogsContext);

export const WithDialogs = ({ children }) => {
    const [dialog, setDialog] = useState(null);

    const Dialogs = {
        show: setDialog,
        close: () => setDialog(null)
    };

    return (
        <DialogsContext.Provider value={Dialogs}>
            {children}
            {dialog}
        </DialogsContext.Provider>);
};
