// SPDX-License-Identifier: LGPL-2.1-or-later

import { transport_globals } from './transport';
import { calculate_application } from './location-utils';

/* Storage
 *
 * Use application to prefix data stored in browser storage
 * with helpers for compatibility.
 */

class StorageHelper {
    #storage: Storage;

    constructor(storage: Storage) {
        this.#storage = storage;
    }

    #getApp(): string {
        if (!transport_globals.default_transport || window.mock)
            return calculate_application();
        return transport_globals.default_transport.application;
    }

    prefixedKey(key: string) {
        return this.#getApp() + ":" + key;
    }

    getItem(key: string, both: boolean) {
        let value = this.#storage.getItem(this.prefixedKey(key));
        if (!value && both)
            value = this.#storage.getItem(key);
        return value;
    }

    setItem(key: string, value: string, both: boolean) {
        this.#storage.setItem(this.prefixedKey(key), value);
        if (both)
            this.#storage.setItem(key, value);
    }

    removeItem(key: string, both: boolean) {
        this.#storage.removeItem(this.prefixedKey(key));
        if (both)
            this.#storage.removeItem(key);
    }

    /* Instead of clearing, purge anything that isn't prefixed with an application
     * and anything prefixed with our application.
     */
    clear(full: boolean) {
        let i = 0;
        while (i < this.#storage.length) {
            const k = this.#storage.key(i) || "";
            if (full && k.indexOf("cockpit") !== 0)
                this.#storage.removeItem(k);
            else if (k.indexOf(this.#getApp()) === 0)
                this.#storage.removeItem(k);
            else
                i++;
        }
    }
}

export const localStorage = new StorageHelper(window.localStorage);
export const sessionStorage = new StorageHelper(window.sessionStorage);
