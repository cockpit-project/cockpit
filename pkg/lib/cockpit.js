/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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

/* eslint-disable indent,no-empty */

import { base64_encode, base64_decode } from './_internal/base64';
import { Channel } from './_internal/channel';
import {
    in_array, is_function, is_object, is_plain_object, invoke_functions, iterate_data, join_data
} from './_internal/common';
import { Deferred, later_invoke } from './_internal/deferred';
import { event_mixin } from './_internal/event-mixin';
import { url_root, transport_origin, calculate_application, calculate_url } from './_internal/location';
import { ensure_transport, transport_globals } from './_internal/transport';

function factory() {
    const cockpit = { };
    event_mixin(cockpit, { });

    cockpit.channel = function channel(options) {
        return new Channel(options);
    };

    cockpit.event_target = function event_target(obj) {
        event_mixin(obj, { });
        return obj;
    };

    /* obsolete backwards compatible shim */
    cockpit.extend = Object.assign;

    /* These can be filled in by loading ../manifests.js */
    cockpit.manifests = { };

    /* ------------------------------------------------------------
     * Text Encoding
     */

    cockpit.base64_encode = base64_encode;
    cockpit.base64_decode = base64_decode;

    cockpit.kill = function kill(host, group) {
        const options = { };
        if (host)
            options.host = host;
        if (group)
            options.group = group;
        cockpit.transport.control("kill", options);
    };

    /* Not public API ... yet? */
    cockpit.hint = function hint(name, options) {
        if (!transport_globals.default_transport)
            return;
        if (!options)
            options = transport_globals.default_host;
        if (typeof options == "string")
            options = { host: options };
        options.hint = name;
        cockpit.transport.control("hint", options);
    };

    cockpit.transport = transport_globals.public_transport = {
        wait: ensure_transport,
        inject: function inject(message, out) {
            if (!transport_globals.default_transport)
                return false;
            if (out === undefined || out)
                return transport_globals.default_transport.send_data(message);
            else
                return transport_globals.default_transport.dispatch_data({ data: message });
        },
        filter: function filter(callback, out) {
            if (out) {
                if (!transport_globals.outgoing_filters)
                    transport_globals.outgoing_filters = [];
                transport_globals.outgoing_filters.push(callback);
            } else {
                if (!transport_globals.incoming_filters)
                    transport_globals.incoming_filters = [];
                transport_globals.incoming_filters.push(callback);
            }
        },
        close: function close(problem) {
            if (transport_globals.default_transport)
                transport_globals.default_transport.close(problem ? { problem } : undefined);
            transport_globals.default_transport = null;
            this.options = { };
        },
        origin: transport_origin,
        options: { },
        uri: calculate_url,
        control: function(command, options) {
            options = { ...options, command };
            ensure_transport(function(transport) {
                transport.send_control(options);
            });
        },
        application: function () {
            if (!transport_globals.default_transport || window.mock)
                return calculate_application();
            return transport_globals.default_transport.application;
        },
    };

    cockpit.when = function when(value, fulfilled, rejected, updated) {
        const result = cockpit.defer();
        result.resolve(value);
        return result.promise.then(fulfilled, rejected, updated);
    };

    cockpit.resolve = function resolve(result) {
        return cockpit.defer().resolve(result).promise;
    };

    cockpit.reject = function reject(ex) {
        return cockpit.defer().reject(ex).promise;
    };

    cockpit.defer = function() {
        return new Deferred();
    };

    /* ---------------------------------------------------------------------
     * Utilities
     */

    const fmt_re = /\$\{([^}]+)\}|\$([a-zA-Z0-9_]+)/g;
    cockpit.format = function format(fmt, args) {
        if (arguments.length != 2 || !is_object(args) || args === null)
            args = Array.prototype.slice.call(arguments, 1);

        function replace(m, x, y) {
            const value = args[x || y];

            /* Special-case 0 (also catches 0.0). All other falsy values return
             * the empty string.
             */
            if (value === 0)
                return '0';

            return value || '';
        }

        return fmt.replace(fmt_re, replace);
    };

    cockpit.format_number = function format_number(number, precision) {
        /* We show given number of digits of precision (default 3), but avoid scientific notation.
         * We also show integers without digits after the comma.
         *
         * We want to localise the decimal separator, but we never want to
         * show thousands separators (to avoid ambiguity).  For this
         * reason, for integers and large enough numbers, we use
         * non-localised conversions (and in both cases, show no
         * fractional part).
         */
        if (precision === undefined)
            precision = 3;
        const lang = cockpit.language === undefined ? undefined : cockpit.language.replace('_', '-');
        const smallestValue = 10 ** (-precision);

        if (!number && number !== 0)
            return "";
        else if (number % 1 === 0)
            return number.toString();
        else if (number > 0 && number <= smallestValue)
            return smallestValue.toLocaleString(lang);
        else if (number < 0 && number >= -smallestValue)
            return (-smallestValue).toLocaleString(lang);
        else if (number > 999 || number < -999)
            return number.toFixed(0);
        else
            return number.toLocaleString(lang, {
                maximumSignificantDigits: precision,
                minimumSignificantDigits: precision,
            });
    };

    let deprecated_format_warned = false;
    function format_units(suffixes, number, second_arg, third_arg) {
        let options = second_arg;
        let factor = options?.base2 ? 1024 : 1000;

        // compat API: we used to accept 'factor' as a separate second arg
        if (third_arg || (second_arg && !is_object(second_arg))) {
            if (!deprecated_format_warned) {
                console.warn(`cockpit.format_{bytes,bits}[_per_sec](..., ${second_arg}, ${third_arg}) is deprecated.`);
                deprecated_format_warned = true;
            }

            factor = second_arg || 1000;
            options = third_arg;
            // double backwards compat: "options" argument position used to be a boolean flag "separate"
            if (!is_object(options))
                options = { separate: options };
        }

        let suffix = null;

        /* Find that factor string */
        if (!number && number !== 0) {
            suffix = null;
        } else if (typeof (factor) === "string") {
            /* Prefer larger factors */
            const keys = [];
            for (const key in suffixes)
                keys.push(key);
            keys.sort().reverse();
            for (let y = 0; y < keys.length; y++) {
                for (let x = 0; x < suffixes[keys[y]].length; x++) {
                    if (factor == suffixes[keys[y]][x]) {
                        number = number / Math.pow(keys[y], x);
                        suffix = factor;
                        break;
                    }
                }
                if (suffix)
                    break;
            }

        /* @factor is a number */
        } else if (factor in suffixes) {
            let divisor = 1;
            for (let i = 0; i < suffixes[factor].length; i++) {
                const quotient = number / divisor;
                if (quotient < factor) {
                    number = quotient;
                    suffix = suffixes[factor][i];
                    break;
                }
                divisor *= factor;
            }
        }

        const string_representation = cockpit.format_number(number, options?.precision);
        let ret;

        if (string_representation && suffix)
            ret = [string_representation, suffix];
        else
            ret = [string_representation];

        if (!options?.separate)
            ret = ret.join(" ");

        return ret;
    }

    const byte_suffixes = {
        1000: ["B", "kB", "MB", "GB", "TB", "PB", "EB", "ZB"],
        1024: ["B", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB"]
    };

    cockpit.format_bytes = function format_bytes(number, ...args) {
        return format_units(byte_suffixes, number, ...args);
    };

    const byte_sec_suffixes = {
        1000: ["B/s", "kB/s", "MB/s", "GB/s", "TB/s", "PB/s", "EB/s", "ZB/s"],
        1024: ["B/s", "KiB/s", "MiB/s", "GiB/s", "TiB/s", "PiB/s", "EiB/s", "ZiB/s"]
    };

    cockpit.format_bytes_per_sec = function format_bytes_per_sec(number, ...args) {
        return format_units(byte_sec_suffixes, number, ...args);
    };

    const bit_suffixes = {
        1000: ["bps", "Kbps", "Mbps", "Gbps", "Tbps", "Pbps", "Ebps", "Zbps"]
    };

    cockpit.format_bits_per_sec = function format_bits_per_sec(number, ...args) {
        return format_units(bit_suffixes, number, ...args);
    };

    /* ---------------------------------------------------------------------
     * Storage Helper.
     *
     * Use application to prefix data stored in browser storage
     * with helpers for compatibility.
     */
    function StorageHelper(storageName) {
        const self = this;
        let storage;

        try {
            storage = window[storageName];
        } catch (e) { }

        self.prefixedKey = function (key) {
            return cockpit.transport.application() + ":" + key;
        };

        self.getItem = function (key, both) {
            let value = storage.getItem(self.prefixedKey(key));
            if (!value && both)
                value = storage.getItem(key);
            return value;
        };

        self.setItem = function (key, value, both) {
            storage.setItem(self.prefixedKey(key), value);
            if (both)
                storage.setItem(key, value);
        };

        self.removeItem = function(key, both) {
            storage.removeItem(self.prefixedKey(key));
            if (both)
                storage.removeItem(key);
        };

        /* Instead of clearing, purge anything that isn't prefixed with an application
         * and anything prefixed with our application.
         */
        self.clear = function(full) {
            let i = 0;
            while (i < storage.length) {
                const k = storage.key(i);
                if (full && k.indexOf("cockpit") !== 0)
                    storage.removeItem(k);
                else if (k.indexOf(cockpit.transport.application()) === 0)
                    storage.removeItem(k);
                else
                    i++;
            }
        };
    }

    cockpit.localStorage = new StorageHelper("localStorage");
    cockpit.sessionStorage = new StorageHelper("sessionStorage");

    /* ---------------------------------------------------------------------
     * Shared data cache.
     *
     * We cannot use sessionStorage when keeping lots of data in memory and
     * sharing it between frames. It has a rather paltry limit on the amount
     * of data it can hold ... so we use window properties instead.
     */

    function lookup_storage(win) {
        let storage;
        if (win.parent && win.parent !== win)
            storage = lookup_storage(win.parent);
        if (!storage) {
            try {
                storage = win["cv1-storage"];
                if (!storage)
                    win["cv1-storage"] = storage = { };
            } catch (ex) { }
        }
        return storage;
    }

    function StorageCache(org_key, provider, consumer) {
        const self = this;
        const key = cockpit.transport.application() + ":" + org_key;

        /* For triggering events and ownership */
        const trigger = window.sessionStorage;
        let last;

        const storage = lookup_storage(window);

        let claimed = false;
        let source;

        function callback() {
            /* Only run the callback if we have a result */
            if (storage[key] !== undefined) {
                const value = storage[key];
                window.setTimeout(function() {
                    if (consumer(value, org_key) === false)
                        self.close();
                });
            }
        }

        function result(value) {
            if (source && !claimed)
                claimed = true;
            if (!claimed)
                return;

            // use a random number to avoid races by separate instances
            const version = Math.floor(Math.random() * 10000000) + 1;

            /* Event for the local window */
            const ev = document.createEvent("StorageEvent");
            ev.initStorageEvent("storage", false, false, key, null,
                                version, window.location, trigger);

            storage[key] = value;
            trigger.setItem(key, version);
            ev.self = self;
            window.dispatchEvent(ev);
        }

        self.claim = function claim() {
            if (source)
                return;

            /* In case we're unclaimed during the callback */
            const claiming = { close: function() { } };
            source = claiming;

            const changed = provider(result, org_key);
            if (source === claiming)
                source = changed;
            else
                changed.close();
        };

        function unclaim() {
            if (source?.close)
                source.close();
            source = null;

            if (!claimed)
                return;

            claimed = false;

            let current_value = trigger.getItem(key);
            if (current_value)
                current_value = parseInt(current_value, 10);
            else
                current_value = null;

            if (last && last === current_value) {
                const ev = document.createEvent("StorageEvent");
                const version = trigger[key];
                ev.initStorageEvent("storage", false, false, key, version,
                                    null, window.location, trigger);
                delete storage[key];
                trigger.removeItem(key);
                ev.self = self;
                window.dispatchEvent(ev);
            }
        }

        function changed(event) {
            if (event.key !== key)
                return;

            /* check where the event came from
               - it came from someone else:
                   if it notifies their unclaim (new value null) and we haven't already claimed, do so
               - it came from ourselves:
                   if the new value doesn't match the actual value in the cache, and
                   we tried to claim (from null to a number), cancel our claim
             */
            if (event.self !== self) {
                if (!event.newValue && !claimed) {
                    self.claim();
                    return;
                }
            } else if (claimed && !event.oldValue && (event.newValue !== trigger.getItem(key))) {
                unclaim();
            }

            let new_value = null;
            if (event.newValue)
                new_value = parseInt(event.newValue, 10);
            if (last !== new_value) {
                last = new_value;
                callback();
            }
        }

        self.close = function() {
            window.removeEventListener("storage", changed, true);
            unclaim();
        };

        window.addEventListener("storage", changed, true);

        /* Always clear this data on unload */
        window.addEventListener("beforeunload", function() {
            self.close();
        });
        window.addEventListener("unload", function() {
            self.close();
        });

        if (trigger.getItem(key))
            callback();
        else
            self.claim();
    }

    cockpit.cache = function cache(key, provider, consumer) {
        return new StorageCache(key, provider, consumer);
    };

    /* ---------------------------------------------------------------------
     * Metrics
     *
     * Implements the cockpit.series and cockpit.grid. Part of the metrics
     * implementations that do not require jquery.
     */

    function SeriesSink(interval, identifier, fetch_callback) {
        const self = this;

        self.interval = interval;
        self.limit = identifier ? 64 * 1024 : 1024;

        /*
         * The cache sits on a window, either our own or a parent
         * window whichever we can access properly.
         *
         * Entries in the index are:
         *
         * { beg: N, items: [], mapping: { }, next: item }
         */
        const index = setup_index(identifier);

        /*
         * A linked list through the index, that we use for expiry
         * of the cache.
         */
        let count = 0;
        let head = null;
        let tail = null;

        function setup_index(id) {
            if (!id)
                return [];

            /* Try and find a good place to cache data */
            const storage = lookup_storage(window);

            let index = storage[id];
            if (!index)
                storage[id] = index = [];
            return index;
        }

        function search(idx, beg) {
            let low = 0;
            let high = idx.length - 1;

            while (low <= high) {
                const mid = (low + high) / 2 | 0;
                const val = idx[mid].beg;
                if (val < beg)
                    low = mid + 1;
                else if (val > beg)
                    high = mid - 1;
                else
                    return mid; /* key found */
            }
            return low;
        }

        function fetch(beg, end, for_walking) {
            if (fetch_callback) {
                if (!for_walking) {
                    /* Stash some fake data synchronously so that we don't ask
                     * again for the same range while they are still fetching
                     * it asynchronously.
                     */
                    stash(beg, new Array(end - beg), { });
                }
                fetch_callback(beg, end, for_walking);
            }
        }

        self.load = function load(beg, end, for_walking) {
            if (end <= beg)
                return;

            const at = search(index, beg);

            const len = index.length;
            let last = beg;

            /* We do this in two phases: First, we walk the index to
             * process what we already have and at the same time make
             * notes about what we need to fetch.  Then we go over the
             * notes and actually fetch what we need.  That way, the
             * fetch callbacks in the second phase can modify the
             * index data structure without disturbing the walk in the
             * first phase.
             */

            const fetches = [];

            /* Data relevant to this range can be at the found index, or earlier */
            for (let i = at > 0 ? at - 1 : at; i < len; i++) {
                const entry = index[i];
                const en = entry.items.length;
                if (!en)
                    continue;

                const eb = entry.beg;
                const b = Math.max(eb, beg);
                const e = Math.min(eb + en, end);

                if (b < e) {
                    if (b > last)
                        fetches.push([last, b]);
                    process(b, entry.items.slice(b - eb, e - eb), entry.mapping);
                    last = e;
                } else if (i >= at) {
                    break; /* no further intersections */
                }
            }

            for (let i = 0; i < fetches.length; i++)
                fetch(fetches[i][0], fetches[i][1], for_walking);

            if (last != end)
                fetch(last, end, for_walking);
        };

        function stash(beg, items, mapping) {
            if (!items.length)
                return;

            let at = search(index, beg);

            const end = beg + items.length;

            const len = index.length;
            let i;
            for (i = at > 0 ? at - 1 : at; i < len; i++) {
                const entry = index[i];
                const en = entry.items.length;
                if (!en)
                    continue;

                const eb = entry.beg;
                const b = Math.max(eb, beg);
                const e = Math.min(eb + en, end);

                /*
                 * We truncate blocks that intersect with this one
                 *
                 * We could adjust them, but in general the loaders are
                 * intelligent enough to only load the required data, so
                 * not doing this optimization yet.
                 */

                if (b < e) {
                    const num = e - b;
                    entry.items.splice(b - eb, num);
                    count -= num;
                    if (b - eb === 0)
                        entry.beg += (e - eb);
                } else if (i >= at) {
                    break; /* no further intersections */
                }
            }

            /* Insert our item into the array */
            const entry = { beg, items, mapping };
            if (!head)
                head = entry;
            if (tail)
                tail.next = entry;
            tail = entry;
            count += items.length;
            index.splice(at, 0, entry);

            /* Remove any items with zero length around insertion point */
            for (at--; at <= i; at++) {
                const entry = index[at];
                if (entry && !entry.items.length) {
                    index.splice(at, 1);
                    at--;
                }
            }

            /* If our index has gotten too big, expire entries */
            while (head && count > self.limit) {
                count -= head.items.length;
                head.items = [];
                head.mapping = null;
                head = head.next || null;
            }

            /* Remove any entries with zero length at beginning */
            const newlen = index.length;
            for (i = 0; i < newlen; i++) {
                if (index[i].items.length > 0)
                    break;
            }
            index.splice(0, i);
        }

        /*
         * Used to populate grids, the keys are grid ids and
         * the values are objects: { grid, rows, notify }
         *
         * The rows field is an object indexed by paths
         * container aliases, and the values are: [ row, path ]
         */
        const registered = { };

        /* An undocumented function called by DataGrid */
        self._register = function _register(grid, id) {
            if (grid.interval != interval)
                throw Error("mismatched metric interval between grid and sink");
            let gdata = registered[id];
            if (!gdata) {
                gdata = registered[id] = { grid, links: [] };
                gdata.links.remove = function remove() {
                    delete registered[id];
                };
            }
            return gdata.links;
        };

        function process(beg, items, mapping) {
            const end = beg + items.length;

            for (const id in registered) {
                const gdata = registered[id];
                const grid = gdata.grid;

                const b = Math.max(beg, grid.beg);
                const e = Math.min(end, grid.end);

                /* Does this grid overlap the bounds of item? */
                if (b < e) {
                    /* Where in the items to take from */
                    const f = b - beg;

                    /* Where and how many to place */
                    const t = b - grid.beg;

                    /* How many to process */
                    const n = e - b;

                    for (let i = 0; i < n; i++) {
                        const klen = gdata.links.length;
                        for (let k = 0; k < klen; k++) {
                            const path = gdata.links[k][0];
                            const row = gdata.links[k][1];

                            /* Calculate the data field to fill in */
                            let data = items[f + i];
                            let map = mapping;
                            const jlen = path.length;
                            for (let j = 0; data !== undefined && j < jlen; j++) {
                                if (!data) {
                                    data = undefined;
                                } else if (map !== undefined && map !== null) {
                                    map = map[path[j]];
                                    if (map)
                                        data = data[map[""]];
                                    else
                                        data = data[path[j]];
                                } else {
                                    data = data[path[j]];
                                }
                            }

                            row[t + i] = data;
                        }
                    }

                    /* Notify the grid, so it can call any functions */
                    grid.notify(t, n);
                }
            }
        }

        self.input = function input(beg, items, mapping) {
            process(beg, items, mapping);
            stash(beg, items, mapping);
        };

        self.close = function () {
            for (const id in registered) {
                const grid = registered[id];
                if (grid?.grid)
                    grid.grid.remove_sink(self);
            }
        };
    }

    cockpit.series = function series(interval, cache, fetch) {
        return new SeriesSink(interval, cache, fetch);
    };

    let unique = 1;

    function SeriesGrid(interval, beg, end) {
        const self = this;

        /* We can trigger events */
        event_mixin(self, { });

        const rows = [];

        self.interval = interval;
        self.beg = 0;
        self.end = 0;

        /*
         * Used to populate table data, the values are:
         * [ callback, row ]
         */
        const callbacks = [];

        const sinks = [];

        let suppress = 0;

        const id = "g1-" + unique;
        unique += 1;

        /* Used while walking */
        let walking = null;
        let offset = null;

        self.notify = function notify(x, n) {
            if (suppress)
                return;
            if (x + n > self.end - self.beg)
                n = (self.end - self.beg) - x;
            if (n <= 0)
                return;
            const jlen = callbacks.length;
            for (let j = 0; j < jlen; j++) {
                const callback = callbacks[j][0];
                const row = callbacks[j][1];
                callback.call(self, row, x, n);
            }

            self.dispatchEvent("notify", x, n);
        };

        self.add = function add(/* sink, path */) {
            const row = [];
            rows.push(row);

            /* Called as add(sink, path) */
            if (is_object(arguments[0])) {
                const sink = arguments[0].series || arguments[0];

                /* The path argument can be an array, or a dot separated string */
                let path = arguments[1];
                if (!path)
                    path = [];
                else if (typeof (path) === "string")
                    path = path.split(".");

                const links = sink._register(self, id);
                if (!links.length)
                    sinks.push({ sink, links });
                links.push([path, row]);

            /* Called as add(callback) */
            } else if (is_function(arguments[0])) {
                const cb = [arguments[0], row];
                if (arguments[1] === true)
                    callbacks.unshift(cb);
                else
                    callbacks.push(cb);

            /* Not called as add() */
            } else if (arguments.length !== 0) {
                throw Error("invalid args to grid.add()");
            }

            return row;
        };

        self.remove = function remove(row) {
            /* Remove from the sinks */
            let ilen = sinks.length;
            for (let i = 0; i < ilen; i++) {
                const jlen = sinks[i].links.length;
                for (let j = 0; j < jlen; j++) {
                    if (sinks[i].links[j][1] === row) {
                        sinks[i].links.splice(j, 1);
                        break;
                    }
                }
            }

            /* Remove from our list of rows */
            ilen = rows.length;
            for (let i = 0; i < ilen; i++) {
                if (rows[i] === row) {
                    rows.splice(i, 1);
                    break;
                }
            }
        };

        self.remove_sink = function remove_sink(sink) {
            const len = sinks.length;
            for (let i = 0; i < len; i++) {
                if (sinks[i].sink === sink) {
                    sinks[i].links.remove();
                    sinks.splice(i, 1);
                    break;
                }
            }
        };

        self.sync = function sync(for_walking) {
            /* Suppress notifications */
            suppress++;

            /* Ask all sinks to load data */
            const len = sinks.length;
            for (let i = 0; i < len; i++) {
                const sink = sinks[i].sink;
                sink.load(self.beg, self.end, for_walking);
            }

            suppress--;

            /* Notify for all rows */
            self.notify(0, self.end - self.beg);
        };

        function move_internal(beg, end, for_walking) {
            if (end === undefined)
                end = beg + (self.end - self.beg);

            if (end < beg)
                beg = end;

            self.beg = beg;
            self.end = end;

            if (!rows.length)
                return;

            rows.forEach(function(row) {
                row.length = 0;
            });

            self.sync(for_walking);
        }

        function stop_walking() {
            window.clearInterval(walking);
            walking = null;
            offset = null;
        }

        function is_negative(n) {
            return ((n = +n) || 1 / n) < 0;
        }

        self.move = function move(beg, end) {
            stop_walking();
            /* Some code paths use now twice.
             * They should use the same value.
             */
            let now = null;

            /* Treat negative numbers relative to now */
            if (beg === undefined) {
                beg = 0;
            } else if (is_negative(beg)) {
                now = Date.now();
                beg = Math.floor(now / self.interval) + beg;
            }
            if (end !== undefined && is_negative(end)) {
                if (now === null)
                    now = Date.now();
                end = Math.floor(now / self.interval) + end;
            }

            move_internal(beg, end, false);
        };

        self.walk = function walk() {
            /* Don't overflow 32 signed bits with the interval since
             * many browsers will mishandle it.  This means that plots
             * that would make about one step every month don't walk
             * at all, but I guess that is ok.
             *
             * For example,
             * https://developer.mozilla.org/en-US/docs/Web/API/setTimeout
             * says:
             *
             *    Browsers including Internet Explorer, Chrome,
             *    Safari, and Firefox store the delay as a 32-bit
             *    signed Integer internally. This causes an Integer
             *    overflow when using delays larger than 2147483647,
             *    resulting in the timeout being executed immediately.
             */

            const start = Date.now();
            if (self.interval > 2000000000)
                return;

            stop_walking();
            offset = start - self.beg * self.interval;
            walking = window.setInterval(function() {
                const now = Date.now();
                move_internal(Math.floor((now - offset) / self.interval), undefined, true);
            }, self.interval);
        };

        self.close = function close() {
            stop_walking();
            while (sinks.length)
                (sinks.pop()).links.remove();
        };

        self.move(beg, end);
    }

    cockpit.grid = function grid(interval, beg, end) {
        return new SeriesGrid(interval, beg, end);
    };

    /* --------------------------------------------------------------------
     * Basic utilities.
     */

    function BasicError(problem, message) {
        this.problem = problem;
        this.message = message || cockpit.message(problem);
        this.toString = function() {
            return this.message;
        };
    }

    cockpit.logout = function logout(reload, reason) {
        /* fully clear session storage */
        cockpit.sessionStorage.clear(true);

        /* Only clean application data from localStorage,
         * except for login-data. Clear that completely */
        cockpit.localStorage.removeItem('login-data', true);
        cockpit.localStorage.clear(false);

        if (reload !== false)
            transport_globals.reload_after_disconnect = true;
        ensure_transport(function(transport) {
            if (!transport.send_control({ command: "logout", disconnect: true }))
                window.location.reload(transport_globals.reload_after_disconnect);
        });
        window.sessionStorage.setItem("logout-intent", "explicit");
        if (reason)
            window.sessionStorage.setItem("logout-reason", reason);
    };

    /* Not public API ... yet? */
    cockpit.drop_privileges = function drop_privileges() {
        ensure_transport(function(transport) {
            transport.send_control({ command: "logout", disconnect: false });
        });
    };

    /* ---------------------------------------------------------------------
     * User and system information
     */

    cockpit.info = { };
    event_mixin(cockpit.info, { });

    transport_globals.init_callback = function(options) {
        if (options.system)
            Object.assign(cockpit.info, options.system);
        if (options.system)
            cockpit.info.dispatchEvent("changed");
    };

    let the_user = null;
    cockpit.user = function () {
            if (!the_user) {
                const dbus = cockpit.dbus(null, { bus: "internal" });
                return dbus.call("/user", "org.freedesktop.DBus.Properties", "GetAll",
                          ["cockpit.User"], { type: "s" })
                    .then(([user]) => {
                        the_user = {
                            id: user.Id.v,
                            gid: user.Gid?.v,
                            name: user.Name.v,
                            full_name: user.Full.v,
                            groups: user.Groups.v,
                            home: user.Home.v,
                            shell: user.Shell.v
                        };
                        return the_user;
                    })
                    .finally(() => dbus.close());
            } else {
                return Promise.resolve(the_user);
            }
    };

    /* ------------------------------------------------------------------------
     * Override for broken browser behavior
     */

    document.addEventListener("click", function(ev) {
        if (ev.target.classList && in_array(ev.target.classList, 'disabled'))
          ev.stopPropagation();
    }, true);

    /* ------------------------------------------------------------------------
     * Cockpit location
     */

    /* HACK: Mozilla will unescape 'window.location.hash' before returning
     * it, which is broken.
     *
     * https://bugzilla.mozilla.org/show_bug.cgi?id=135309
     */

    let last_loc = null;

    function get_window_location_hash() {
        return (window.location.href.split('#')[1] || '');
    }

    function Location() {
        const self = this;
        const application = cockpit.transport.application();
        self.url_root = url_root || "";

        if (window.mock?.url_root)
            self.url_root = window.mock.url_root;

        if (application.indexOf("cockpit+=") === 0) {
            if (self.url_root)
                self.url_root += '/';
            self.url_root = self.url_root + application.replace("cockpit+", '');
        }

        const href = get_window_location_hash();
        const options = { };
        self.path = decode(href, options);

        /* Resolve dots and double dots */
        function resolve_path_dots(parts) {
            const out = [];
            const length = parts.length;
            for (let i = 0; i < length; i++) {
                const part = parts[i];
                if (part === "" || part == ".") {
                    continue;
                } else if (part == "..") {
                    if (out.length === 0)
                        return null;
                    out.pop();
                } else {
                    out.push(part);
                }
            }
            return out;
        }

        function decode_path(input) {
            const parts = input.split('/').map(decodeURIComponent);
            let result, i;
            let pre_parts = [];

            if (self.url_root)
                pre_parts = self.url_root.split('/').map(decodeURIComponent);

            if (input && input[0] !== "/") {
                result = [].concat(self.path);
                result.pop();
                result = result.concat(parts);
            } else {
                result = parts;
            }

            result = resolve_path_dots(result);
            for (i = 0; i < pre_parts.length; i++) {
                if (pre_parts[i] !== result[i])
                    break;
            }
            if (i == pre_parts.length)
                result.splice(0, pre_parts.length);

            return result;
        }

        function encode(path, options, with_root) {
            if (typeof path == "string")
                path = decode_path(path);

            let href = "/" + path.map(encodeURIComponent).join("/");
            if (with_root && self.url_root && href.indexOf("/" + self.url_root + "/") !== 0)
                href = "/" + self.url_root + href;

            /* Undo unnecessary encoding of these */
            href = href.replaceAll("%40", "@");
            href = href.replaceAll("%3D", "=");
            href = href.replaceAll("%2B", "+");
            href = href.replaceAll("%23", "#");

            let opt;
            const query = [];
            function push_option(v) {
                query.push(encodeURIComponent(opt) + "=" + encodeURIComponent(v));
            }

            if (options) {
                for (opt in options) {
                    let value = options[opt];
                    if (!Array.isArray(value))
                        value = [value];
                    value.forEach(push_option);
                }
                if (query.length > 0)
                    href += "?" + query.join("&");
            }
            return href;
        }

        function decode(href, options) {
            if (href[0] == '#')
                href = href.substr(1);

            const pos = href.indexOf('?');
            const first = (pos === -1) ? href : href.substr(0, pos);
            const path = decode_path(first);
            if (pos !== -1 && options) {
                href.substring(pos + 1).split("&")
                .forEach(function(opt) {
                    const parts = opt.split('=');
                    const name = decodeURIComponent(parts[0]);
                    const value = decodeURIComponent(parts[1]);
                    if (options[name]) {
                        let last = options[name];
                        if (!Array.isArray(value))
                            last = options[name] = [last];
                        last.push(value);
                    } else {
                        options[name] = value;
                    }
                });
            }

            return path;
        }

        function href_for_go_or_replace(/* ... */) {
            let href;
            if (arguments.length == 1 && arguments[0] instanceof Location) {
                href = String(arguments[0]);
            } else if (typeof arguments[0] == "string") {
                const options = arguments[1] || { };
                href = encode(decode(arguments[0], options), options);
            } else {
                href = encode.apply(self, arguments);
            }
            return href;
        }

        function replace(/* ... */) {
            if (self !== last_loc)
                return;
            const href = href_for_go_or_replace.apply(self, arguments);
            window.location.replace(window.location.pathname + '#' + href);
        }

        function go(/* ... */) {
            if (self !== last_loc)
                return;
            const href = href_for_go_or_replace.apply(self, arguments);
            window.location.hash = '#' + href;
        }

        Object.defineProperties(self, {
            path: {
                enumerable: true,
                writable: false,
                value: self.path
            },
            options: {
                enumerable: true,
                writable: false,
                value: options
            },
            href: {
                enumerable: true,
                value: href
            },
            go: { value: go },
            replace: { value: replace },
            encode: { value: encode },
            decode: { value: decode },
            toString: { value: function() { return href } }
        });
    }

    Object.defineProperty(cockpit, "location", {
        enumerable: true,
        get: function() {
            if (!last_loc || last_loc.href !== get_window_location_hash())
                last_loc = new Location();
            return last_loc;
        },
        set: function(v) {
            cockpit.location.go(v);
        }
    });

    window.addEventListener("hashchange", function() {
        last_loc = null;
        let hash = window.location.hash;
        if (hash.indexOf("#") === 0)
            hash = hash.substring(1);
        cockpit.hint("location", { hash });
        cockpit.dispatchEvent("locationchanged");
    });

    /* ------------------------------------------------------------------------
     * Cockpit jump
     */

    cockpit.jump = function jump(path, host) {
        if (Array.isArray(path))
            path = "/" + path.map(encodeURIComponent).join("/")
.replaceAll("%40", "@")
.replaceAll("%3D", "=")
.replaceAll("%2B", "+");
        else
            path = "" + path;

        /* When host is not given (undefined), use current transport's host. If
         * it is null, use localhost.
         */
        if (host === undefined)
            host = cockpit.transport.host;

        const options = { command: "jump", location: path, host };
        cockpit.transport.inject("\n" + JSON.stringify(options));
    };

    /* ---------------------------------------------------------------------
     * Cockpit Page Visibility
     */

    (function() {
        let hiddenHint = false;

        function visibility_change() {
            let value = document.hidden;
            if (value === false)
                value = hiddenHint;
            if (cockpit.hidden !== value) {
                cockpit.hidden = value;
                cockpit.dispatchEvent("visibilitychange");
            }
        }

        document.addEventListener("visibilitychange", visibility_change);

        /*
         * Wait for changes in visibility of just our iframe. These are delivered
         * via a hint message from the parent. For now we are the only handler of
         * hint messages, so this is implemented rather simply on purpose.
         */
        transport_globals.process_hints = function(data) {
            if ("hidden" in data) {
                hiddenHint = data.hidden;
                visibility_change();
            }
        };

        /* The first time */
        visibility_change();
    }());

    /* ---------------------------------------------------------------------
     * Spawning
     */

    function ProcessError(options, name) {
        this.problem = options.problem || null;
        this.exit_status = options["exit-status"];
        if (this.exit_status === undefined)
            this.exit_status = null;
        this.exit_signal = options["exit-signal"];
        if (this.exit_signal === undefined)
            this.exit_signal = null;
        this.message = options.message;

        if (this.message === undefined) {
            if (this.problem)
                this.message = cockpit.message(options.problem);
            else if (this.exit_signal !== null)
                this.message = cockpit.format(_("$0 killed with signal $1"), name, this.exit_signal);
            else if (this.exit_status !== undefined)
                this.message = cockpit.format(_("$0 exited with code $1"), name, this.exit_status);
            else
                this.message = cockpit.format(_("$0 failed"), name);
        } else {
            this.message = this.message.trim();
        }

        this.toString = function() {
            return this.message;
        };
    }

    function spawn_debug() {
        if (window.debugging == "all" || window.debugging?.includes("spawn"))
            console.debug.apply(console, arguments);
    }

    /* public */
    cockpit.spawn = function(command, options) {
        const dfd = cockpit.defer();

        const args = { payload: "stream", spawn: [] };
        if (command instanceof Array) {
            for (let i = 0; i < command.length; i++)
                args.spawn.push(String(command[i]));
        } else {
            args.spawn.push(String(command));
        }
        if (options !== undefined)
            Object.assign(args, options);

        spawn_debug("process spawn:", JSON.stringify(args.spawn));

        const name = args.spawn[0] || "process";
        const channel = cockpit.channel(args);

        /* Callback that wants a stream response, see below */
        const buffer = channel.buffer(null);

        channel.addEventListener("close", function(event, options) {
            const data = buffer.squash();
            spawn_debug("process closed:", JSON.stringify(options));
            if (data)
                spawn_debug("process output:", data);
            if (options.message !== undefined)
                spawn_debug("process error:", options.message);

            if (options.problem)
                dfd.reject(new ProcessError(options, name));
            else if (options["exit-status"] || options["exit-signal"])
                dfd.reject(new ProcessError(options, name), data);
            else if (options.message !== undefined)
                dfd.resolve(data, options.message);
            else
                dfd.resolve(data);
        });

        const ret = dfd.promise;
        ret.stream = function(callback) {
            buffer.callback = callback.bind(ret);
            return this;
        };

        ret.input = function(message, stream) {
            if (message !== null && message !== undefined) {
                spawn_debug("process input:", message);
                iterate_data(message, function(data) {
                    channel.send(data);
                });
            }
            if (!stream)
                channel.control({ command: "done" });
            return this;
        };

        ret.close = function(problem) {
            spawn_debug("process closing:", problem);
            if (channel.valid)
                channel.close(problem);
            return this;
        };

        return ret;
    };

    /* public */
    cockpit.script = function(script, args, options) {
        if (!options && is_plain_object(args)) {
            options = args;
            args = [];
        }
        const command = ["/bin/sh", "-c", script, "--"];
        command.push.apply(command, args);
        return cockpit.spawn(command, options);
    };

    function dbus_debug() {
        if (window.debugging == "all" || window.debugging?.includes("dbus"))
            console.debug.apply(console, arguments);
    }

    function DBusError(arg, arg1) {
        if (typeof (arg) == "string") {
            this.problem = arg;
            this.name = null;
            this.message = arg1 || cockpit.message(arg);
        } else {
            this.problem = null;
            this.name = arg[0];
            this.message = arg[1][0] || arg[0];
        }
        this.toString = function() {
            return this.message;
        };
    }

    function DBusCache() {
        const self = this;

        let callbacks = [];
        self.data = { };
        self.meta = { };

        self.connect = function connect(path, iface, callback, first) {
            const cb = [path, iface, callback];
            if (first)
                callbacks.unshift(cb);
            else
                callbacks.push(cb);
            return {
                remove: function remove() {
                    const length = callbacks.length;
                    for (let i = 0; i < length; i++) {
                        const cb = callbacks[i];
                        if (cb[0] === path && cb[1] === iface && cb[2] === callback) {
                            delete cb[i];
                            break;
                        }
                    }
                }
            };
        };

        function emit(path, iface, props) {
            const copy = callbacks.slice();
            const length = copy.length;
            for (let i = 0; i < length; i++) {
                const cb = copy[i];
                if ((!cb[0] || cb[0] === path) &&
                    (!cb[1] || cb[1] === iface)) {
                    cb[2](props, path);
                }
            }
        }

        self.update = function update(path, iface, props) {
            if (!self.data[path])
                self.data[path] = { };
            if (!self.data[path][iface])
                self.data[path][iface] = props;
            else
                props = Object.assign(self.data[path][iface], props);
            emit(path, iface, props);
        };

        self.remove = function remove(path, iface) {
            if (self.data[path]) {
                delete self.data[path][iface];
                emit(path, iface, null);
            }
        };

        self.lookup = function lookup(path, iface) {
            if (self.data[path])
                return self.data[path][iface];
            return undefined;
        };

        self.each = function each(iface, callback) {
            for (const path in self.data) {
                for (const ifa in self.data[path]) {
                    if (ifa == iface)
                        callback(self.data[path][iface], path);
                }
            }
        };

        self.close = function close() {
            self.data = { };
            const copy = callbacks;
            callbacks = [];
            const length = copy.length;
            for (let i = 0; i < length; i++)
                copy[i].callback();
        };
    }

    function DBusProxy(client, cache, iface, path, options) {
        const self = this;
        event_mixin(self, { });

        let valid = false;
        let defined = false;
        const waits = cockpit.defer();

        /* No enumeration on these properties */
        Object.defineProperties(self, {
            client: { value: client, enumerable: false, writable: false },
            path: { value: path, enumerable: false, writable: false },
            iface: { value: iface, enumerable: false, writable: false },
            valid: { get: function() { return valid }, enumerable: false },
            wait: {
                enumerable: false,
                writable: false,
                value: function(func) {
                    if (func)
                        waits.promise.always(func);
                    return waits.promise;
                }
            },
            call: {
                value: function(name, args, options) { return client.call(path, iface, name, args, options) },
                enumerable: false,
                writable: false
            },
            data: { value: { }, enumerable: false }
        });

        if (!options)
            options = { };

        function define() {
            if (!cache.meta[iface])
                return;

            const meta = cache.meta[iface];
            defined = true;

            Object.keys(meta.methods || { }).forEach(function(name) {
                if (name[0].toLowerCase() == name[0])
                    return; /* Only map upper case */

                /* Again, make sure these don't show up in enumerations */
                Object.defineProperty(self, name, {
                    enumerable: false,
                    value: function() {
                        const dfd = cockpit.defer();
                        client.call(path, iface, name, Array.prototype.slice.call(arguments))
                            .done(function(reply) { dfd.resolve.apply(dfd, reply) })
                            .fail(function(ex) { dfd.reject(ex) });
                        return dfd.promise;
                    }
                });
            });

            Object.keys(meta.properties || { }).forEach(function(name) {
                if (name[0].toLowerCase() == name[0])
                    return; /* Only map upper case */

                const config = {
                    enumerable: true,
                    get: function() { return self.data[name] },
                    set: function(v) { throw Error(name + "is not writable") }
                };

                const prop = meta.properties[name];
                if (prop.flags && prop.flags.indexOf('w') !== -1) {
                    config.set = function(v) {
                        client.call(path, "org.freedesktop.DBus.Properties", "Set",
                                [iface, name, cockpit.variant(prop.type, v)])
                            .fail(function(ex) {
                                console.log("Couldn't set " + iface + " " + name +
                                            " at " + path + ": " + ex);
                            });
                    };
                }

                /* Again, make sure these don't show up in enumerations */
                Object.defineProperty(self, name, config);
            });
        }

        function update(props) {
            if (props) {
                Object.assign(self.data, props);
                if (!defined)
                    define();
                valid = true;
            } else {
                valid = false;
            }
            self.dispatchEvent("changed", props);
        }

        cache.connect(path, iface, update, true);
        update(cache.lookup(path, iface));

        function signal(path, iface, name, args) {
            self.dispatchEvent("signal", name, args);
            if (name[0].toLowerCase() != name[0]) {
                args = args.slice();
                args.unshift(name);
                self.dispatchEvent.apply(self, args);
            }
        }

        client.subscribe({ path, interface: iface }, signal, options.subscribe !== false);

        function waited(ex) {
            if (valid)
                waits.resolve();
            else
                waits.reject(ex);
        }

        /* If watching then do a proper watch, otherwise object is done */
        if (options.watch !== false)
            client.watch({ path, interface: iface }).always(waited);
        else
            waited();
    }

    function DBusProxies(client, cache, iface, path_namespace, options) {
        const self = this;
        event_mixin(self, { });

        let waits;

        Object.defineProperties(self, {
            client: { value: client, enumerable: false, writable: false },
            iface: { value: iface, enumerable: false, writable: false },
            path_namespace: { value: path_namespace, enumerable: false, writable: false },
            wait: {
                enumerable: false,
                writable: false,
                value: function(func) {
                    if (func)
                        waits.always(func);
                    return waits;
                }
            }
        });

        /* Subscribe to signals once for all proxies */
        const match = { interface: iface, path_namespace };

        /* Callbacks added by proxies */
        client.subscribe(match);

        /* Watch for property changes */
        if (options.watch !== false) {
            waits = client.watch(match);
        } else {
            waits = cockpit.defer().resolve().promise;
        }

        /* Already added watch/subscribe, tell proxies not to */
        options = { watch: false, subscribe: false, ...options };

        function update(props, path) {
            let proxy = self[path];
            if (path) {
                if (!props && proxy) {
                    delete self[path];
                    self.dispatchEvent("removed", proxy);
                } else if (props) {
                    if (!proxy) {
                        proxy = self[path] = client.proxy(iface, path, options);
                        self.dispatchEvent("added", proxy);
                    }
                    self.dispatchEvent("changed", proxy);
                }
            }
        }

        cache.connect(null, iface, update, false);
        cache.each(iface, update);
    }

    function DBusClient(name, options) {
        const self = this;
        event_mixin(self, { });

        const args = { };
        let track = false;
        let owner = null;

        if (options) {
            if (options.track)
                track = true;

            delete options.track;
            Object.assign(args, options);
        }
        args.payload = "dbus-json3";
        if (name)
            args.name = name;
        self.options = options;
        self.unique_name = null;

        dbus_debug("dbus open: ", args);

        let channel = cockpit.channel(args);
        const subscribers = { };
        let calls = { };
        let cache;

        /* The problem we closed with */
        let closed;

        self.constructors = { "*": DBusProxy };

        /* Allows waiting on the channel if necessary */
        self.wait = channel.wait;

        function ensure_cache() {
            if (!cache)
                cache = new DBusCache();
        }

        function send(payload) {
            if (channel?.valid) {
                dbus_debug("dbus:", payload);
                channel.send(payload);
                return true;
            }
            return false;
        }

        function matches(signal, match) {
            if (match.path && signal[0] !== match.path)
                return false;
            if (match.path_namespace && signal[0].indexOf(match.path_namespace) !== 0)
                return false;
            if (match.interface && signal[1] !== match.interface)
                return false;
            if (match.member && signal[2] !== match.member)
                return false;
            if (match.arg0 && (!signal[3] || signal[3][0] !== match.arg0))
                return false;
            return true;
        }

        function on_message(event, payload) {
            dbus_debug("dbus:", payload);
            let msg;
            try {
                msg = JSON.parse(payload);
            } catch (ex) {
                console.warn("received invalid dbus json message:", ex);
            }
            if (msg === undefined) {
                channel.close({ problem: "protocol-error" });
                return;
            }
            const dfd = (msg.id !== undefined) ? calls[msg.id] : undefined;
            if (msg.reply) {
                if (dfd) {
                    const options = { };
                    if (msg.type)
                        options.type = msg.type;
                    if (msg.flags)
                        options.flags = msg.flags;
                    dfd.resolve(msg.reply[0] || [], options);
                    delete calls[msg.id];
                }
                return;
            } else if (msg.error) {
                if (dfd) {
                    dfd.reject(new DBusError(msg.error));
                    delete calls[msg.id];
                }
                return;
            }

            /*
             * The above promise resolutions or failures are triggered via
             * later_invoke(). In order to preserve ordering guarantees we
             * also have to process other events that way too.
             */
            later_invoke(function() {
                if (msg.signal) {
                    for (const id in subscribers) {
                        const subscription = subscribers[id];
                        if (subscription.callback) {
                            if (matches(msg.signal, subscription.match))
                                subscription.callback.apply(self, msg.signal);
                        }
                    }
                } else if (msg.notify) {
                    notify(msg.notify);
                } else if (msg.meta) {
                    meta(msg.meta);
                } else if (msg.owner !== undefined) {
                    self.dispatchEvent("owner", msg.owner);

                    /*
                     * We won't get this signal with the same
                     * owner twice so if we've seen an owner
                     * before that means it has changed.
                     */
                    if (track && owner)
                        self.close();

                    owner = msg.owner;
                } else {
                    dbus_debug("received unexpected dbus json message:", payload);
                }
            });
        }

        function meta(data) {
            ensure_cache();
            Object.assign(cache.meta, data);
            self.dispatchEvent("meta", data);
        }

        function notify(data) {
            ensure_cache();
            for (const path in data) {
                for (const iface in data[path]) {
                    const props = data[path][iface];
                    if (!props)
                        cache.remove(path, iface);
                    else
                        cache.update(path, iface, props);
                }
            }
            self.dispatchEvent("notify", data);
        }

        this.notify = notify;

        function close_perform(options) {
            closed = options.problem || "disconnected";
            const outstanding = calls;
            calls = { };
            for (const id in outstanding) {
                outstanding[id].reject(new DBusError(closed, options.message));
            }
            self.dispatchEvent("close", options);
        }

        this.close = function close(options) {
            if (typeof options == "string")
                options = { problem: options };
            if (!options)
                options = { };
            if (channel)
                channel.close(options);
            else
                close_perform(options);
        };

        function on_ready(event, message) {
            dbus_debug("dbus ready:", options);
            self.unique_name = message["unique-name"];
        }

        function on_close(event, options) {
            dbus_debug("dbus close:", options);
            channel.removeEventListener("ready", on_ready);
            channel.removeEventListener("message", on_message);
            channel.removeEventListener("close", on_close);
            channel = null;
            close_perform(options);
        }

        channel.addEventListener("ready", on_ready);
        channel.addEventListener("message", on_message);
        channel.addEventListener("close", on_close);

        let last_cookie = 1;

        this.call = function call(path, iface, method, args, options) {
            const dfd = cockpit.defer();
            const id = String(last_cookie);
            last_cookie++;
            const method_call = {
                ...options,
                call: [path, iface, method, args || []],
                id
            };

            const msg = JSON.stringify(method_call);
            if (send(msg))
                calls[id] = dfd;
            else
                dfd.reject(new DBusError(closed));

            return dfd.promise;
        };

        self.signal = function signal(path, iface, member, args, options) {
            if (!channel || !channel.valid)
                return;

            const message = { ...options, signal: [path, iface, member, args || []] };

            send(JSON.stringify(message));
        };

        this.subscribe = function subscribe(match, callback, rule) {
            const subscription = {
                match: { ...match },
                callback
            };

            if (rule !== false)
                send(JSON.stringify({ "add-match": subscription.match }));

            let id;
            if (callback) {
                id = String(last_cookie);
                last_cookie++;
                subscribers[id] = subscription;
            }

            return {
                remove: function() {
                    let prev;
                    if (id) {
                        prev = subscribers[id];
                        if (prev)
                            delete subscribers[id];
                    }
                    if (rule !== false && prev)
                        send(JSON.stringify({ "remove-match": prev.match }));
                }
            };
        };

        self.watch = function watch(path) {
            const match = is_plain_object(path) ? { ...path } : { path: String(path) };

            const id = String(last_cookie);
            last_cookie++;
            const dfd = cockpit.defer();

            const msg = JSON.stringify({ watch: match, id });
            if (send(msg))
                calls[id] = dfd;
            else
                dfd.reject(new DBusError(closed));

            const ret = dfd.promise;
            ret.remove = function remove() {
                if (id in calls) {
                    dfd.reject(new DBusError("cancelled"));
                    delete calls[id];
                }
                send(JSON.stringify({ unwatch: match }));
            };
            return ret;
        };

        self.proxy = function proxy(iface, path, options) {
            if (!iface)
                iface = name;
            iface = String(iface);
            if (!path)
                path = "/" + iface.replaceAll(".", "/");
            let Constructor = self.constructors[iface];
            if (!Constructor)
                Constructor = self.constructors["*"];
            if (!options)
                options = { };
            ensure_cache();
            return new Constructor(self, cache, iface, String(path), options);
        };

        self.proxies = function proxies(iface, path_namespace, options) {
            if (!iface)
                iface = name;
            if (!path_namespace)
                path_namespace = "/";
            if (!options)
                options = { };
            ensure_cache();
            return new DBusProxies(self, cache, String(iface), String(path_namespace), options);
        };
    }

    /* Well known buses */
    const shared_dbus = {
        internal: null,
        session: null,
        system: null,
    };

    /* public */
    cockpit.dbus = function dbus(name, options) {
        if (!options)
            options = { bus: "system" };

        /*
         * Figure out if this we should use a shared bus.
         *
         * This is only the case if a null name *and* the
         * options are just a simple { "bus": "xxxx" }
         */
        const keys = Object.keys(options);
        const bus = options.bus;
        const shared = !name && keys.length == 1 && bus in shared_dbus;

        if (shared && shared_dbus[bus])
            return shared_dbus[bus];

        const client = new DBusClient(name, options);

        /*
         * Store the shared bus for next time. Override the
         * close function to only work when a problem is
         * indicated.
         */
        if (shared) {
            const old_close = client.close;
            client.close = function() {
                if (arguments.length > 0)
                    old_close.apply(client, arguments);
            };
            client.addEventListener("close", function() {
                if (shared_dbus[bus] == client)
                    shared_dbus[bus] = null;
            });
            shared_dbus[bus] = client;
        }

        return client;
    };

    cockpit.variant = function variant(type, value) {
        return { v: value, t: type };
    };

    cockpit.byte_array = function byte_array(string) {
        return window.btoa(string);
    };

    /* File access
     */

    cockpit.file = function file(path, options) {
        options = options || { };
        const binary = options.binary;

        const self = {
            path,
            read,
            replace,
            modify,

            watch,

            close
        };

        const base_channel_options = { ...options };
        delete base_channel_options.syntax;

        function parse(str) {
            if (options.syntax?.parse)
                return options.syntax.parse(str);
            else
                return str;
        }

        function stringify(obj) {
            if (options.syntax?.stringify)
                return options.syntax.stringify(obj);
            else
                return obj;
        }

        let read_promise = null;
        let read_channel;

        function read() {
            if (read_promise)
                return read_promise;

            const dfd = cockpit.defer();
            const opts = {
                ...base_channel_options,
                payload: "fsread1",
                path
            };

            function try_read() {
                read_channel = cockpit.channel(opts);
                const content_parts = [];
                read_channel.addEventListener("message", function (event, message) {
                    content_parts.push(message);
                });
                read_channel.addEventListener("close", function (event, message) {
                    read_channel = null;

                    if (message.problem == "change-conflict") {
                        try_read();
                        return;
                    }

                    read_promise = null;

                    if (message.problem) {
                        const error = new BasicError(message.problem, message.message);
                        fire_watch_callbacks(null, null, error);
                        dfd.reject(error);
                        return;
                    }

                    let content;
                    if (message.tag == "-")
                        content = null;
                    else {
                        try {
                            content = parse(join_data(content_parts, binary));
                        } catch (e) {
                            fire_watch_callbacks(null, null, e);
                            dfd.reject(e);
                            return;
                        }
                    }

                    fire_watch_callbacks(content, message.tag);
                    dfd.resolve(content, message.tag);
                });
            }

            try_read();

            read_promise = dfd.promise;
            return read_promise;
        }

        let replace_channel = null;

        function replace(new_content, expected_tag) {
            const dfd = cockpit.defer();

            let file_content;
            try {
                file_content = (new_content === null) ? null : stringify(new_content);
            } catch (e) {
                dfd.reject(e);
                return dfd.promise;
            }

            if (replace_channel)
                replace_channel.close("abort");

            const opts = {
                ...base_channel_options,
                payload: "fsreplace1",
                path,
                tag: expected_tag
            };
            replace_channel = cockpit.channel(opts);

            replace_channel.addEventListener("close", function (event, message) {
                replace_channel = null;
                if (message.problem) {
                    dfd.reject(new BasicError(message.problem, message.message));
                } else {
                    fire_watch_callbacks(new_content, message.tag);
                    dfd.resolve(message.tag);
                }
            });

            iterate_data(file_content, function(data) {
                replace_channel.send(data);
            });

            replace_channel.control({ command: "done" });
            return dfd.promise;
        }

        function modify(callback, initial_content, initial_tag) {
            const dfd = cockpit.defer();

            function update(content, tag) {
                let new_content = callback(content);
                if (new_content === undefined)
                    new_content = content;
                replace(new_content, tag)
                    .done(function (new_tag) {
                        dfd.resolve(new_content, new_tag);
                    })
                    .fail(function (error) {
                        if (error.problem == "change-conflict")
                            read_then_update();
                        else
                            dfd.reject(error);
                    });
            }

            function read_then_update() {
                read()
                    .done(update)
                    .fail(function (error) {
                        dfd.reject(error);
                    });
            }

            if (initial_content === undefined)
                read_then_update();
            else
                update(initial_content, initial_tag);

            return dfd.promise;
        }

        const watch_callbacks = [];
        let n_watch_callbacks = 0;

        let watch_channel = null;
        let watch_tag;

        function ensure_watch_channel(options) {
            if (n_watch_callbacks > 0) {
                if (watch_channel)
                    return;

                const opts = {
                    payload: "fswatch1",
                    path,
                    superuser: base_channel_options.superuser,
                };
                watch_channel = cockpit.channel(opts);
                watch_channel.addEventListener("message", function (event, message_string) {
                    let message;
                    try {
                        message = JSON.parse(message_string);
                    } catch (e) {
                        message = null;
                    }
                    if (message && message.path == path && message.tag && message.tag != watch_tag) {
                        if (options && options.read !== undefined && !options.read)
                            fire_watch_callbacks(null, message.tag);
                        else
                            read();
                    }
                });
            } else {
                if (watch_channel) {
                    watch_channel.close();
                    watch_channel = null;
                }
            }
        }

        function fire_watch_callbacks(/* content, tag, error */) {
            watch_tag = arguments[1] || null;
            invoke_functions(watch_callbacks, self, arguments);
        }

        function watch(callback, options) {
            if (callback)
                watch_callbacks.push(callback);
            n_watch_callbacks += 1;
            ensure_watch_channel(options);

            watch_tag = null;
            read();

            return {
                remove: function () {
                    if (callback) {
                        const index = watch_callbacks.indexOf(callback);
                        if (index > -1)
                            watch_callbacks[index] = null;
                    }
                    n_watch_callbacks -= 1;
                    ensure_watch_channel(options);
                }
            };
        }

        function close() {
            if (read_channel)
                read_channel.close("cancelled");
            if (replace_channel)
                replace_channel.close("cancelled");
            if (watch_channel)
                watch_channel.close("cancelled");
        }

        return self;
    };

    /* ---------------------------------------------------------------------
     * Localization
     */

    let po_data = { };
    let po_plural;

    cockpit.language = "en";
    cockpit.language_direction = "ltr";
    const test_l10n = window.localStorage.test_l10n;

    cockpit.locale = function locale(po) {
        let lang = cockpit.language;
        let lang_dir = cockpit.language_direction;
        let header;

        if (po) {
            Object.assign(po_data, po);
            header = po[""];
        } else if (po === null) {
            po_data = { };
        }

        if (header) {
            if (header["plural-forms"])
                po_plural = header["plural-forms"];
            if (header.language)
                lang = header.language;
            if (header["language-direction"])
                lang_dir = header["language-direction"];
        }

        cockpit.language = lang;
        cockpit.language_direction = lang_dir;
    };

    cockpit.translate = function translate(/* ... */) {
        let what;

        /* Called without arguments, entire document */
        if (arguments.length === 0)
            what = [document];

        /* Called with a single array like argument */
        else if (arguments.length === 1 && arguments[0].length)
            what = arguments[0];

        /* Called with 1 or more element arguments */
        else
            what = arguments;

        /* Translate all the things */
        const wlen = what.length;
        for (let w = 0; w < wlen; w++) {
            /* The list of things to translate */
            let list = null;
            if (what[w].querySelectorAll)
                list = what[w].querySelectorAll("[translatable], [translate]");
            if (!list)
                continue;

            /* Each element */
            for (let i = 0; i < list.length; i++) {
                const el = list[i];

                let val = el.getAttribute("translate") || el.getAttribute("translatable") || "yes";
                if (val == "no")
                    continue;

                /* Each thing to translate */
                const tasks = val.split(" ");
                val = el.getAttribute("translate-context") || el.getAttribute("context");
                for (let t = 0; t < tasks.length; t++) {
                    if (tasks[t] == "yes" || tasks[t] == "translate")
                        el.textContent = cockpit.gettext(val, el.textContent);
                    else if (tasks[t])
                        el.setAttribute(tasks[t], cockpit.gettext(val, el.getAttribute(tasks[t]) || ""));
                }

                /* Mark this thing as translated */
                el.removeAttribute("translatable");
                el.removeAttribute("translate");
            }
        }
    };

    cockpit.gettext = function gettext(context, string) {
        /* Missing first parameter */
        if (arguments.length == 1) {
            string = context;
            context = undefined;
        }

        const key = context ? context + '\u0004' + string : string;
        if (po_data) {
            const translated = po_data[key];
            if (translated?.[1])
                string = translated[1];
        }

        if (test_l10n === 'true')
            return "»" + string + "«";

        return string;
    };

    function imply(val) {
        return (val === true ? 1 : val || 0);
    }

    cockpit.ngettext = function ngettext(context, string1, stringN, num) {
        /* Missing first parameter */
        if (arguments.length == 3) {
            num = stringN;
            stringN = string1;
            string1 = context;
            context = undefined;
        }

        const key = context ? context + '\u0004' + string1 : string1;
        if (po_data && po_plural) {
            const translated = po_data[key];
            if (translated) {
                const i = imply(po_plural(num)) + 1;
                if (translated[i])
                    return translated[i];
            }
        }
        if (num == 1)
            return string1;
        return stringN;
    };

    cockpit.noop = function noop(arg0, arg1) {
        return arguments[arguments.length - 1];
    };

    /* Only for _() calls here in the cockpit code */
    const _ = cockpit.gettext;

    cockpit.message = function message(arg) {
        if (arg.message)
            return arg.message;

        let problem = null;
        if (arg.problem)
            problem = arg.problem;
        else
            problem = arg + "";
        if (problem == "terminated")
            return _("Your session has been terminated.");
        else if (problem == "no-session")
            return _("Your session has expired. Please log in again.");
        else if (problem == "access-denied")
            return _("Not permitted to perform this action.");
        else if (problem == "authentication-failed")
            return _("Login failed");
        else if (problem == "authentication-not-supported")
            return _("The server refused to authenticate using any supported methods.");
        else if (problem == "unknown-hostkey")
            return _("Untrusted host");
        else if (problem == "unknown-host")
            return _("Untrusted host");
        else if (problem == "invalid-hostkey")
            return _("Host key is incorrect");
        else if (problem == "internal-error")
            return _("Internal error");
        else if (problem == "timeout")
            return _("Connection has timed out.");
        else if (problem == "no-cockpit")
            return _("Cockpit is not installed on the system.");
        else if (problem == "no-forwarding")
            return _("Cannot forward login credentials");
        else if (problem == "disconnected")
            return _("Server has closed the connection.");
        else if (problem == "not-supported")
            return _("Cockpit is not compatible with the software on the system.");
        else if (problem == "no-host")
            return _("Cockpit could not contact the given host.");
        else if (problem == "too-large")
            return _("Too much data");
        else
            return problem;
    };

    function HttpError(arg0, arg1, message) {
        this.status = parseInt(arg0, 10);
        this.reason = arg1;
        this.message = message || arg1;
        this.problem = null;

        this.valueOf = function() {
            return this.status;
        };
        this.toString = function() {
            return this.status + " " + this.message;
        };
    }

    function http_debug() {
        if (window.debugging == "all" || window.debugging?.includes("http"))
            console.debug.apply(console, arguments);
    }

    function find_header(headers, name) {
        if (!headers)
            return undefined;
        name = name.toLowerCase();
        for (const head in headers) {
            if (head.toLowerCase() == name)
                return headers[head];
        }
        return undefined;
    }

    function HttpClient(endpoint, options) {
        const self = this;

        self.options = options;
        options.payload = "http-stream2";

        const active_requests = [];

        if (endpoint !== undefined) {
            if (endpoint.indexOf && endpoint.indexOf("/") === 0) {
                options.unix = endpoint;
            } else {
                const port = parseInt(endpoint, 10);
                if (!isNaN(port))
                    options.port = port;
                else
                    throw Error("The endpoint must be either a unix path or port number");
            }
        }

        if (options.address) {
            if (!options.capabilities)
                options.capabilities = [];
            options.capabilities.push("address");
        }

        function param(obj) {
            return Object.keys(obj).map(function(k) {
                return encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]);
            })
.join('&')
.split('%20')
.join('+'); /* split/join because phantomjs */
        }

        self.request = function request(req) {
            const dfd = cockpit.defer();
            const ret = dfd.promise;

            if (!req.path)
                req.path = "/";
            if (!req.method)
                req.method = "GET";
            if (req.params) {
                if (req.path.indexOf("?") === -1)
                    req.path += "?" + param(req.params);
                else
                    req.path += "&" + param(req.params);
            }
            delete req.params;

            const input = req.body;
            delete req.body;

            const headers = req.headers;
            delete req.headers;

            Object.assign(req, options);

            /* Combine the headers */
            if (options.headers && headers)
                req.headers = { ...options.headers, ...headers };
            else if (options.headers)
                req.headers = options.headers;
            else
                req.headers = headers;

            http_debug("http request:", JSON.stringify(req));

            /* We need a channel for the request */
            const channel = cockpit.channel(req);

            if (input !== undefined) {
                if (input !== "") {
                    http_debug("http input:", input);
                    iterate_data(input, function(data) {
                        channel.send(data);
                    });
                }
                http_debug("http done");
                channel.control({ command: "done" });
            }

            /* Callbacks that want to stream or get headers */
            let streamer = null;
            let responsers = null;

            let resp = null;

            const buffer = channel.buffer(function(data) {
                /* Fire any streamers */
                if (resp && resp.status >= 200 && resp.status <= 299 && streamer)
                    return streamer.call(ret, data);
                return 0;
            });

            function on_control(event, options) {
                /* Anyone looking for response details? */
                if (options.command == "response") {
                    resp = options;
                    if (responsers) {
                        resp.headers = resp.headers || { };
                        invoke_functions(responsers, ret, [resp.status, resp.headers]);
                    }
                }
            }

            function on_close(event, options) {
                const pos = active_requests.indexOf(ret);
                if (pos >= 0)
                    active_requests.splice(pos, 1);

                if (options.problem) {
                    http_debug("http problem: ", options.problem);
                    dfd.reject(new BasicError(options.problem, options.message));
                } else {
                    const body = buffer.squash();

                    /* An error, fail here */
                    if (resp && (resp.status < 200 || resp.status > 299)) {
                        let message;
                        const type = find_header(resp.headers, "Content-Type");
                        if (type && !channel.binary) {
                            if (type.indexOf("text/plain") === 0)
                                message = body;
                        }
                        http_debug("http status: ", resp.status);
                        dfd.reject(new HttpError(resp.status, resp.reason, message), body);
                    } else {
                        http_debug("http done");
                        dfd.resolve(body);
                    }
                }

                channel.removeEventListener("control", on_control);
                channel.removeEventListener("close", on_close);
            }

            channel.addEventListener("control", on_control);
            channel.addEventListener("close", on_close);

            ret.stream = function(callback) {
                streamer = callback;
                return ret;
            };
            ret.response = function(callback) {
                if (responsers === null)
                    responsers = [];
                responsers.push(callback);
                return ret;
            };
            ret.input = function(message, stream) {
                if (message !== null && message !== undefined) {
                    http_debug("http input:", message);
                    iterate_data(message, function(data) {
                        channel.send(data);
                    });
                }
                if (!stream) {
                    http_debug("http done");
                    channel.control({ command: "done" });
                }
                return ret;
            };
            ret.close = function(problem) {
                http_debug("http closing:", problem);
                channel.close(problem);
                return ret;
            };

            active_requests.push(ret);
            return ret;
        };

        self.get = function get(path, params, headers) {
            return self.request({
                method: "GET",
                params,
                path,
                body: "",
                headers
            });
        };

        self.post = function post(path, body, headers) {
            headers = headers || { };

            if (is_plain_object(body) || Array.isArray(body)) {
                body = JSON.stringify(body);
                if (find_header(headers, "Content-Type") === undefined)
                    headers["Content-Type"] = "application/json";
            } else if (body === undefined || body === null) {
                body = "";
            } else if (typeof body !== "string") {
                body = String(body);
            }

            return self.request({
                method: "POST",
                path,
                body,
                headers
            });
        };

        self.close = function close(problem) {
            const reqs = active_requests.slice();
            for (let i = 0; i < reqs.length; i++)
                reqs[i].close(problem);
        };
    }

    /* public */
    cockpit.http = function(endpoint, options) {
        if (is_plain_object(endpoint) && options === undefined) {
            options = endpoint;
            endpoint = undefined;
        }
        return new HttpClient(endpoint, options || { });
    };

    /* ---------------------------------------------------------------------
     * Permission
     */

    function check_superuser() {
        return new Promise((resolve, reject) => {
            const ch = cockpit.channel({ payload: "null", superuser: "require" });
            ch.wait()
                .then(() => resolve(true))
                .catch(() => resolve(false))
                .always(() => ch.close());
        });
    }

    function Permission(options) {
        const self = this;
        event_mixin(self, { });

        const api = cockpit.dbus(null, { bus: "internal" }).proxy("cockpit.Superuser", "/superuser");
        api.addEventListener("changed", maybe_reload);

        function maybe_reload() {
            if (api.valid && self.allowed !== null) {
                if (self.allowed != (api.Current != "none"))
                    window.location.reload(true);
            }
        }

        self.allowed = null;
        self.user = options ? options.user : null; // pre-fill for unit tests
        self.is_superuser = options ? options._is_superuser : null; // pre-fill for unit tests

        let group = null;
        let admin = false;

        if (options)
            group = options.group;

        if (options?.admin)
            admin = true;

        function decide(user) {
            if (user.id === 0)
                return true;

            if (group)
                return !!(user.groups || []).includes(group);

            if (admin)
                return self.is_superuser;

            if (user.id === undefined)
                return null;

            return false;
        }

        if (self.user && self.is_superuser !== null) {
            self.allowed = decide(self.user);
        } else {
            Promise.all([cockpit.user(), check_superuser()])
                .then(([user, is_superuser]) => {
                    self.user = user;
                    self.is_superuser = is_superuser;
                    const allowed = decide(user);
                    if (self.allowed !== allowed) {
                        self.allowed = allowed;
                        maybe_reload();
                        self.dispatchEvent("changed");
                    }
                });
        }

        self.close = function close() {
            /* no-op for now */
        };
    }

    cockpit.permission = function permission(arg) {
        return new Permission(arg);
    };

    /* ---------------------------------------------------------------------
     * Metrics
     *
     */

    function MetricsChannel(interval, options_list, cache) {
        const self = this;
        event_mixin(self, { });

        if (options_list.length === undefined)
            options_list = [options_list];

        const channels = [];
        let following = false;

        self.series = cockpit.series(interval, cache, fetch_for_series);
        self.archives = null;
        self.meta = null;

        function fetch_for_series(beg, end, for_walking) {
            if (!for_walking)
                self.fetch(beg, end);
            else
                self.follow();
        }

        function transfer(options_list, callback, is_archive) {
            if (options_list.length === 0)
                return;

            if (!is_archive) {
                if (following)
                    return;
                following = true;
            }

            const options = {
                payload: "metrics1",
                interval,
                source: "internal",
                ...options_list[0]
            };

            delete options.archive_source;

            const channel = cockpit.channel(options);
            channels.push(channel);

            let meta = null;
            let last = null;
            let beg;

            channel.addEventListener("close", function(ev, close_options) {
                if (!is_archive)
                    following = false;

                if (options_list.length > 1 &&
                    (close_options.problem == "not-supported" || close_options.problem == "not-found")) {
                    transfer(options_list.slice(1), callback);
                } else if (close_options.problem) {
                    if (close_options.problem != "terminated" &&
                        close_options.problem != "disconnected" &&
                        close_options.problem != "authentication-failed" &&
                        (close_options.problem != "not-found" || !is_archive) &&
                        (close_options.problem != "not-supported" || !is_archive)) {
                        console.warn("metrics channel failed: " + close_options.problem);
                    }
                } else if (is_archive) {
                    if (!self.archives) {
                        self.archives = true;
                        self.dispatchEvent('changed');
                    }
                }
            });

            channel.addEventListener("message", function(ev, payload) {
                const message = JSON.parse(payload);

                /* A meta message? */
                const message_len = message.length;
                if (message_len === undefined) {
                    meta = message;
                    let timestamp = 0;
                    if (meta.now && meta.timestamp)
                        timestamp = meta.timestamp + (Date.now() - meta.now);
                    beg = Math.floor(timestamp / interval);
                    callback(beg, meta, null, options_list[0]);

                    /* Trigger to outside interest that meta changed */
                    self.meta = meta;
                    self.dispatchEvent('changed');

                /* A data message */
                } else if (meta) {
                    /* Data decompression */
                    for (let i = 0; i < message_len; i++) {
                        const data = message[i];
                        if (last) {
                            for (let j = 0; j < last.length; j++) {
                                const dataj = data[j];
                                if (dataj === null || dataj === undefined) {
                                    data[j] = last[j];
                                } else {
                                    const dataj_len = dataj.length;
                                    if (dataj_len !== undefined) {
                                        const lastj = last[j];
                                        const lastj_len = last[j].length;
                                        let k;
                                        for (k = 0; k < dataj_len; k++) {
                                            if (dataj[k] === null)
                                                dataj[k] = lastj[k];
                                        }
                                        for (; k < lastj_len; k++)
                                            dataj[k] = lastj[k];
                                    }
                                }
                            }
                        }
                        last = data;
                    }

                    /* Return the data */
                    callback(beg, meta, message, options_list[0]);

                    /* Bump timestamp for the next message */
                    beg += message_len;
                    meta.timestamp += (interval * message_len);
                }
            });
        }

        function drain(beg, meta, message, options) {
            /* Generate a mapping object if necessary */
            let mapping = meta.mapping;
            if (!mapping) {
                mapping = { };
                meta.metrics.forEach(function(metric, i) {
                    const map = { "": i };
                    const name = options.metrics_path_names?.[i] ?? metric.name;
                    mapping[name] = map;
                    if (metric.instances) {
                        metric.instances.forEach(function(instance, i) {
                            if (instance === "")
                                instance = "/";
                            map[instance] = { "": i };
                        });
                    }
                });
                meta.mapping = mapping;
            }

            if (message)
                self.series.input(beg, message, mapping);
        }

        self.fetch = function fetch(beg, end) {
            const timestamp = beg * interval - Date.now();
            const limit = end - beg;

            const archive_options_list = [];
            for (let i = 0; i < options_list.length; i++) {
                if (options_list[i].archive_source) {
                    archive_options_list.push({
                                                   ...options_list[i],
                                                   source: options_list[i].archive_source,
                                                   timestamp,
                                                   limit
                                              });
                }
            }

            transfer(archive_options_list, drain, true);
        };

        self.follow = function follow() {
            transfer(options_list, drain);
        };

        self.close = function close(options) {
            const len = channels.length;
            if (self.series)
                self.series.close();

            for (let i = 0; i < len; i++)
                channels[i].close(options);
        };
    }

    cockpit.metrics = function metrics(interval, options) {
        return new MetricsChannel(interval, options);
    };

    /* ---------------------------------------------------------------------
     * Ooops handling.
     *
     * If we're embedded, send oops to parent frame. Since everything
     * could be broken at this point, just do it manually, without
     * involving cockpit.transport or any of that logic.
     */

    cockpit.oops = function oops() {
        if (window.parent !== window && window.name.indexOf("cockpit1:") === 0)
            window.parent.postMessage("\n{ \"command\": \"oops\" }", transport_origin);
    };

    const old_onerror = window.onerror;
    window.onerror = function(msg, url, line) {
        // Errors with url == "" are not logged apparently, so let's
        // not show the "Oops" for them either.
        if (url != "")
            cockpit.oops();
        if (old_onerror)
            return old_onerror(msg, url, line);
        return false;
    };

    cockpit.assert = (predicate, message) => {
        if (!predicate) {
            throw new Error(`Assertion failed: ${message}`);
        }
    };

    return cockpit;
}

const cockpit = factory();
export default cockpit;

// Register cockpit object as global, so that it can be used without ES6 modules
// we need to do that here instead of in pkg/base1/cockpit.js, so that po.js can access cockpit already
window.cockpit = cockpit;
