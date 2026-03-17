// SPDX-License-Identifier: LGPL-2.1-or-later

import { transport_globals, ensure_transport } from './_internal/transport';
import { localStorage, sessionStorage } from './_internal/storage';

/* Logout
 */

export function logout(reload: boolean, reason?: string) {
    /* fully clear session storage */
    sessionStorage.clear(true);

    /* Only clean application data from localStorage,
     * except for login-data. Clear that completely */
    localStorage.removeItem('login-data', true);
    localStorage.clear(false);

    if (reload !== false)
        transport_globals.reload_after_disconnect = true;
    ensure_transport(function(transport) {
        if (!transport.send_control({ command: "logout", disconnect: true })) {
            // @ts-expect-error: Firefox has a force-reload parameter.
            window.location.reload(reload);
        }
    });
    window.sessionStorage.setItem("logout-intent", "explicit");
    if (reason)
        window.sessionStorage.setItem("logout-reason", reason);
}
