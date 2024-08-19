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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
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
 *
 * - Dialogs.show(component)
 *
 * Calling "Dialogs.show" will render the given component as a direct
 * child of the inner-most enclosing "WithDialogs" component.  The
 * component is of course intended to be a dialog, such as
 * Patternfly's "Modal".  There is only ever one of these; a second
 * call to "show" is considered a bug and "Dialogs.close" must be called first.
 *
 * - Dialogs.close()
 *
 * Calling "Dialogs.close()" will close the currently open Dialog.  It can only
 * be used with dialogs shown by `Dialogs.show()`.
 *
 * - Dialogs.run(component, {... props})
 *
 * Shows a dialog and asynchronously waits for it to close.  This creates and
 * shows a MyDialog with the given properties, plus a special "dialogResult"
 * property which has .resolve() and .reject() methods on it.  Calling either
 * of those will resolve the promise returned by Dialogs.run() accordingly,
 * closing the dialog in the process.  The created dialog cannot be closed with
 * Dialogs.close(). See the example:
 *
 * const MyDialog = ({ title, dialogResult }) => {
 *     return (
 *         <Modal title={title}>
 *             <Button onClick={() => dialogResult.resolve("yes")}>Yes</Button>
 *             <Button onClick={() => dialogResult.resolve("no")}>No</Button>
 *         </Modal>
 *     );
 * };
 *
 * const AsyncDialogExample = () => {
 *     const Dialogs = useDialogs();
 *
 *     const clicked = async () => {
 *         try {
 *             const result = await Dialogs.run(MyDialog, { title: "Example" });
 *             console.log(result);
 *         } catch (err) {
 *         }
 *     };
 *
 *     return <Button onClick={clicked}>Open dialog</Button>;
 * };
 *
 * - Dialogs.isActive()
 *
 * Returns `true` if a dialog is currently being shown.
 *
 */

import React, { useContext, useState, useRef } from "react";

export interface DialogResult<T> {
    resolve(value: T): void;
    reject(exc: unknown): void;
}

export interface Dialogs {
    show(dialog: React.ReactNode): void;
    close(): void;
    run<T, P>(component: React.ComponentType<P & { dialogResult: DialogResult<T> }>, properties: P): Promise<T>;
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
    const [dialog, setDialog] = useState<React.ReactNode>(null);
    type State = "close" | "show" | "run";
    const shown = useRef<State>("close");

    function transition(expected: State, to: State, arg: React.ReactNode = null) {
        if (shown.current !== expected)
            throw new Error(`Dialogs.${to}(${JSON.stringify(arg)}) called, but that's only valid ` +
                            `after .${expected}(), current dialog is ${JSON.stringify(dialog)}.`);
        shown.current = to;
        setDialog(arg);
    }

    const Dialogs: Dialogs = {
        show: (component: React.ReactNode) => transition("close", "show", component),
        close: () => transition("show", "close"),
        run: async (component, props) => {
            try {
                return await new Promise((resolve, reject) => {
                    transition("close", "run",
                               React.createElement(component, { ...props, dialogResult: { resolve, reject } }));
                });
            } finally {
                transition("run", "close");
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
