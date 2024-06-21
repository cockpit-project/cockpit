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
 *
 * The "WithDialogs" component enables all its children to show
 * dialogs.  Such a dialog will stay open as long as the WithDialogs
 * component itself is mounted.  Thus, you should put the WithDialogs
 * component somewhere high up in your component tree, maybe even as
 * the very top-most component.
 *
 * If your Cockpit application has multiple pages and navigation
 * between these pages is controlled by the browser URL, then each of
 * these pages should have its own WithDialogs wrapper. This way, a
 * dialog opened on one page closes when the user navigates away from
 * that page. To make sure that React maintains separate states for
 * WithDialogs components, give them unique "key" properties.
 *
 * A component that wants to show a dialogs needs to get hold of the
 * current "Dialogs" context and then call it's "show" method.  For a
 * function component the Dialogs context is returned by
 * "useDialogs()", as shown above in the example.
 *
 * A class component can declare a static context type and then use
 * "this.context" to find the Dialogs object:
 *
 * import { DialogsContext } from "dialogs.jsx";
 *
 * class ExampleButton extends React.Component {
 *   static contextType = DialogsContext;
 *
 *   function render() {
 *     const Dialogs = this.context;
 *     return <Button onClick={() => Dialogs.show(<MyDialog />)}>Open dialog</Button>;
 *   }
 * }
 *
 * If there is a situation where you want to wait until a Dialog is closed
 * after opening, you can "await Dialogs.show(<My Dialog />)"
 *
 * class Example extends React.Component {
 *   static contextType = DialogsContext;
 *
 *   async function handleClick() {
 *     try {
 *       const result = await Dialogs.show(<MyDialog />);
 *       console.log(result);
 *     catch (err) {
 *     }
 *
 *   }
 *
 *   function render() {
 *     const Dialogs = this.context;
 *     return <Button onClick={() => this.handleClick}>Open dialog</Button>;
 *   }
 * }
 *
 * class MyDialog extends React.Component {
 *   static contextType = DialogsContext;
 *
 *   render() {
 *     <Button onClick={() => Dialogs.close("yes")}>Yes</Button>
 *     <Button onClick={() => Dialogs.close("no")}>No</Button>
 *   }
 * }
 *
 *
 * - Dialogs.show(component)
 *
 * Calling "Dialogs.show" will render the given component as a direct
 * child of the inner-most enclosing "WithDialogs" component.  The
 * component is of course intended to be a dialog, such as
 * Patternfly's "Modal".  There is only ever one of these; a second
 * call to "show" is considered a bug and "Dialogs.close" should be called first.
 * "Dialogs.show" returns a promise that is settled by either "Dialogs.close" or
 * "Dialogs.reject".
 *
 * - Dialogs.close([args])
 *
 * Calling "Dialogs.close([args])" will close the currently open Dialog and
 * optionally resolve the promise with the provided "args".
 *
 * - Dialogs.reject(err)
  *
 * Calling "Dialogs.reject(err)" will close the currently open Dialog
 * and reject the promise with the provided Error.
 */

import React, { useContext, useRef, useState } from "react";

export interface Dialogs {
    show(dialog: React.ReactNode): Promise<unknown>;
    close(args: unknown): void;
    reject(err: unknown): void;
    isActive(): boolean;
}

export const DialogsContext = React.createContext<Dialogs | null>(null);
export const useDialogs = () => {
    const dialogs = useContext(DialogsContext);
    if (dialogs === null) {
        throw new Error("useDialogs can only be called inside of <WithDialogs/>");
    }
    return dialogs;
};

export const WithDialogs = ({ children } : { children: React.ReactNode }) => {
    const is_open = useRef(false); // synchronous
    const resolveRef = useRef<((x: unknown) => void) | null>(null);
    const rejectRef = useRef<((x: unknown) => void) | null>(null);
    const [dialog, setDialog] = useState<React.ReactNode>(null);

    const Dialogs: Dialogs = {
        show: component => {
            if (component && is_open.current)
                console.error("Dialogs.show() called for",
                              JSON.stringify(component),
                              "while a dialog is already open:",
                              JSON.stringify(dialog));
            is_open.current = !!component;
            setDialog(component);
            return new Promise((resolve, reject) => {
                resolveRef.current = resolve;
                rejectRef.current = reject;
            });
        },
        close: (args) => {
            is_open.current = false;
            setDialog(null);
            if (resolveRef.current !== null) {
                resolveRef.current(args);
                resolveRef.current = null;
                rejectRef.current = null;
            }
        },
        reject: (err) => {
            is_open.current = false;
            setDialog(null);
            if (rejectRef.current !== null) {
                rejectRef.current(err);
                resolveRef.current = null;
                rejectRef.current = null;
            }
        },
        isActive: () => dialog !== null
    };

    return (
        <DialogsContext.Provider value={Dialogs}>
            {children}
            {dialog}
        </DialogsContext.Provider>);
};
