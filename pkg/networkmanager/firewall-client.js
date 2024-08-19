/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
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

import cockpit from 'cockpit';
import * as service from 'service';
import { debounce } from 'throttle-debounce';
import * as utils from './utils.js';

const firewall = {
    owner: undefined,
    installed: true,
    enabled: false,
    readonly: true,
    services: {},
    enabledServices: new Set(),
    /* Dictionary where zone ID is the key and zone information, as fetched by
     * fetchZoneInfos, the value */
    zones: {},
    activeZones: new Set(),
    /* Zones predefined by firewalld, from untrusted to trusted */
    predefinedZones: ['drop', 'block', 'public', 'external',
        'dmz', 'work', 'home', 'internal', 'trusted'],
    defaultZone: null,
    availableInterfaces: [],
    ready: false
};

cockpit.event_target(firewall);

utils.list_interfaces().then(interfaces => {
    firewall.availableInterfaces = interfaces;
});

const firewalld_service = service.proxy('firewalld');
let firewalld_dbus = null;

function debug() {
    if (window.debugging == "all" || window.debugging?.includes("firewalld")) // not-covered: debugging
        console.debug("firewalld:", ...arguments); // not-covered: debugging
}

firewall.debouncedGetZones = debounce(300, () => {
    getZones()
            .then(() => getServices())
            .then(() => firewall.debouncedEvent('changed'))
            .catch(error => console.warn(error));
});

/* As certain dbus signal callbacks might change the firewall frequently
 * in a short period of time, prevent rapid succession of renders by
 * debouncing the ('changed') event */
firewall.debouncedEvent = debounce(300, event => firewall.dispatchEvent(event));

/* As a service might be removed from multiple zones at the same time,
 * prevent rapid succession of GetServices call */
firewall.debouncedGetServices = debounce(300, () => {
    getServices().then(() => firewall.debouncedEvent('changed'));
});

function initFirewalldDbus() {
    debug("initializing D-Bus connection");
    if (firewalld_dbus)
        firewalld_dbus.close();

    firewalld_dbus = cockpit.dbus('org.fedoraproject.FirewallD1', { superuser: "try" });

    firewalld_dbus.addEventListener('owner', (event, owner) => {
        if (firewall.owner === owner)
            return;
        debug("owner changed:", JSON.stringify(owner));

        firewall.owner = owner;
        firewall.enabled = !!owner;

        firewall.zones = {};
        firewall.activeZones = new Set();
        firewall.services = {};
        firewall.enabledServices = new Set();

        if (!firewall.enabled) {
            firewall.ready = true;
            firewall.dispatchEvent('changed');
            return;
        }

        getZones()
                .then(() => getServices())
                .catch(error => console.warn(error))
                .then(() => { firewall.ready = true })
                .then(() => firewall.debouncedEvent('changed'));
    });

    firewalld_dbus.subscribe({
        interface: 'org.fedoraproject.FirewallD1.zone',
        path: '/org/fedoraproject/FirewallD1',
        member: 'ServiceAdded'
    }, (path, iface, signal, args) => {
        const zone = args[0];
        const service = args[1];
        fetchZoneInfos([zone])
                .then(() => fetchServiceInfos([service]))
                .then(info => firewall.enabledServices.add(info[0].id))
                .then(() => firewall.debouncedEvent('changed'))
                .catch(error => console.warn(error));
    });

    firewalld_dbus.subscribe({
        interface: 'org.fedoraproject.FirewallD1.zone',
        path: '/org/fedoraproject/FirewallD1',
        member: 'ServiceRemoved'
    }, (path, iface, signal, args) => {
        const zone = args[0];
        const service = args[1];

        firewall.zones[zone].services = firewall.zones[zone].services.filter(s => s !== service);
        firewall.enabledServices.delete(service);
        firewall.debouncedGetServices();
    });

    firewalld_dbus.subscribe({
        interface: 'org.fedoraproject.FirewallD1.zone',
        path: '/org/fedoraproject/FirewallD1',
        member: 'PortAdded'
    }, (path, iface, signal, args) => {
        const zone = args[0];
        const port = args[1];
        const protocol = args[2];
        if (!firewall.zones[zone].ports.some(p => p.port === port && p.protocol === protocol)) {
            firewall.zones[zone].ports.push({ port, protocol });
            firewall.debouncedEvent('changed');
        }
    });

    firewalld_dbus.subscribe({
        interface: 'org.fedoraproject.FirewallD1.zone',
        path: '/org/fedoraproject/FirewallD1',
        member: 'PortRemoved'
    }, (path, iface, signal, args) => {
        const zone = args[0];
        const port = args[1];
        const protocol = args[2];
        firewall.zones[zone].ports = firewall.zones[zone].ports
                .filter(p => p.port !== port || p.protocol !== protocol);
        firewall.debouncedEvent('changed');
    });

    firewalld_dbus.subscribe({
        interface: 'org.fedoraproject.FirewallD1',
        path: '/org/fedoraproject/FirewallD1',
        member: 'Reloaded'
    }, () => firewall.debouncedGetZones());

    /* There are two APIs available, changeZoneOf(Interface|Source) and
     * add(Interface|Source). Listen to both of them for any background changes
     * to zones. */
    firewalld_dbus.subscribe({
        interface: 'org.fedoraproject.FirewallD1.zone',
        path: '/org/fedoraproject/FirewallD1',
        member: 'ZoneOfInterfaceChanged'
    }, () => firewall.debouncedGetZones());
    firewalld_dbus.subscribe({
        interface: 'org.fedoraproject.FirewallD1.zone',
        path: '/org/fedoraproject/FirewallD1',
        member: 'ZoneOfSourceChanged'
    }, () => firewall.debouncedGetZones());

    firewalld_dbus.subscribe({
        interface: 'org.fedoraproject.FirewallD1.zone',
        path: '/org/fedoraproject/FirewallD1',
        member: 'InterfaceAdded'
    }, () => firewall.debouncedGetZones());
    firewalld_dbus.subscribe({
        interface: 'org.fedoraproject.FirewallD1.zone',
        path: '/org/fedoraproject/FirewallD1',
        member: 'SourceAdded'
    }, () => firewall.debouncedGetZones());
    firewalld_dbus.subscribe({
        interface: 'org.fedoraproject.FirewallD1.zone',
        path: '/org/fedoraproject/FirewallD1',
        member: 'InterfaceRemoved'
    }, () => firewall.debouncedGetZones());
    firewalld_dbus.subscribe({
        interface: 'org.fedoraproject.FirewallD1.zone',
        path: '/org/fedoraproject/FirewallD1',
        member: 'SourceRemoved'
    }, () => firewall.debouncedGetZones());
}

firewalld_service.addEventListener('changed', () => {
    const installed = !!firewalld_service.exists;
    const is_running = firewalld_service.state === 'running';

    // we get lots of these events, for internal property changes; filter interesting changes
    if (is_running === firewalld_service.prev_running && firewall.installed === installed)
        return;
    firewall.installed = installed;
    firewalld_service.prev_running = is_running;

    debug("systemd service changed: exists", firewalld_service.exists, "state", firewalld_service.state,
          "firewall.enabled:", JSON.stringify(firewall.enabled));

    /* HACK: cockpit.dbus() remains dead for non-activatable names, so reinitialize it if the service gets enabled and started
     * See https://github.com/cockpit-project/cockpit/pull/9125 */
    if (!firewall.enabled && is_running) {
        debug("reinitializing D-Bus connection after unit got started");
        initFirewalldDbus();
    }

    firewall.dispatchEvent('changed');
});

function getZones() {
    return firewalld_dbus.call('/org/fedoraproject/FirewallD1',
                               'org.fedoraproject.FirewallD1.zone',
                               'getActiveZones', [])
            .then(reply => fetchZoneInfos(Object.keys(reply[0])))
            .then(zones => {
                firewall.activeZones = new Set(zones.map(z => z.id));
                debug("getActiveZones succeeded:", JSON.stringify([...firewall.activeZones]));
            })
            .then(() => firewalld_dbus.call('/org/fedoraproject/FirewallD1',
                                            'org.fedoraproject.FirewallD1',
                                            'getDefaultZone', []))
            .then(reply => {
                firewall.defaultZone = reply[0];
            })
            .then(() => firewalld_dbus.call('/org/fedoraproject/FirewallD1',
                                            'org.fedoraproject.FirewallD1.zone',
                                            'getZones', []))
            .then(reply => fetchZoneInfos(reply[0]));
}

function getServices() {
    if (firewall.readonly)
        return Promise.resolve();
    firewall.enabledServices = new Set();
    return Promise.all([...firewall.activeZones].map(z => {
        return firewalld_dbus.call('/org/fedoraproject/FirewallD1',
                                   'org.fedoraproject.FirewallD1.zone',
                                   'getServices', [z])
                .then(reply => fetchServiceInfos(reply[0]))
                .then(services => {
                    const promises = [];
                    for (const s of services) {
                        firewall.enabledServices.add(s.id);
                        if (s.includes.length)
                            promises.push(fetchServiceInfos(s.includes));
                    }
                    return Promise.all(promises);
                });
    }));
}

function fetchServiceInfos(services) {
    return Promise.all(services.map(service => {
        if (firewall.services[service])
            return firewall.services[service];

        let info;
        return firewalld_dbus.call('/org/fedoraproject/FirewallD1',
                                   'org.fedoraproject.FirewallD1',
                                   'getServiceSettings2', [service])
                .then(([{ short, description, ports }]) => {
                    short = short ? short.v : "";
                    description = description ? description.v : "";
                    ports = ports ? ports.v : [];
                    info = {
                        id: service,
                        name: short,
                        description,
                        ports: ports.map(p => ({ port: p[0], protocol: p[1] })),
                        includes: [],
                    };

                    firewall.services[service] = info;
                    return firewalld_dbus.call('/org/fedoraproject/FirewallD1/config',
                                               'org.fedoraproject.FirewallD1.config',
                                               'getServiceByName', [service]);
                })
                .then(path => firewalld_dbus.call(path[0],
                                                  'org.fedoraproject.FirewallD1.config.service',
                                                  'getSettings2', []))
                .then(reply => {
                    if (reply[0].includes) {
                        info.includes = reply[0].includes.v;
                        firewall.services[service] = info;
                    }
                    return info;
                })
                .catch(error => {
                    if (error.name === 'org.freedesktop.DBus.Error.UnknownMethod')
                        return info;
                    return Promise.reject(error);
                });
    }));
}

function fetchZoneInfos(zones) {
    return Promise.all(zones.map(zone => {
        if (firewall.readonly) {
            const info = {
                id: zone,
                name: zone,
                description: null,
                target: null,
                services: [],
                ports: [],
                interfaces: [],
                source: [],
            };
            firewall.zones[zone] = info;
            return info;
        }
        return firewalld_dbus.call('/org/fedoraproject/FirewallD1',
                                   'org.fedoraproject.FirewallD1.zone',
                                   'getZoneSettings2', [zone])
                .then(([zoneInfo]) => {
                    const info = {
                        id: zone,
                        name: (zoneInfo.short || {}).v,
                        description: (zoneInfo.description || {}).v,
                        target: (zoneInfo.target || {}).v,
                        services: ((zoneInfo.services || {}).v || []),
                        ports: ((zoneInfo.ports || {}).v || []).map(p => ({ port: p[0], protocol: p[1] })),
                        interfaces: ((zoneInfo.interfaces || {}).v || []),
                        source: ((zoneInfo.sources || {}).v || []),
                    };
                    firewall.zones[zone] = info;
                    return info;
                });
    }));
}

initFirewalldDbus();

cockpit.spawn(['sh', '-c', 'pkcheck --action-id org.fedoraproject.FirewallD1.all --process $$ --allow-user-interaction 2>&1'], { superuser: "try" })
        .then(() => {
            firewall.readonly = false;
            firewall.debouncedEvent('changed');
            firewall.debouncedGetZones();
        })
        .catch(error => {
            console.log("pkcheck failed", error);

            // Fall back to cockpit.permissions, "pkcheck" might not be available,
            // always allow edits by admins
            const permission = cockpit.permission({ admin: true });
            const update_permissions = () => {
                firewall.readonly = !permission.allowed;
                firewall.debouncedEvent('changed');
                firewall.debouncedGetZones();
            };
            permission.addEventListener("changed", update_permissions);
        });

firewall.enable = () => firewalld_service.enable().then(() => firewalld_service.start());
firewall.disable = () => firewalld_service.disable().then(() => firewalld_service.stop());

firewall.getAvailableServices = () => {
    return firewalld_dbus.call('/org/fedoraproject/FirewallD1',
                               'org.fedoraproject.FirewallD1',
                               'listServices', [])
            .then(reply => fetchServiceInfos(reply[0]))
            .catch(error => console.warn(error));
};

/*
 * Only call this after defining a new service, as it will remove existing
 * non-permanent configurations.
 */
firewall.reload = () => {
    return firewalld_dbus.call('/org/fedoraproject/FirewallD1',
                               'org.fedoraproject.FirewallD1',
                               'reload', [])
            .catch(error => console.warn(error));
};

/*
 * Remove a service from the specified zone (i.e., close its ports).
 *
 * Returns a promise that resolves when the service is removed.
 */
firewall.removeService = (zone, service) => {
    return firewalld_dbus.call('/org/fedoraproject/FirewallD1',
                               'org.fedoraproject.FirewallD1.zone',
                               'removeService', [zone, service])
            .then(reply => firewalld_dbus.call('/org/fedoraproject/FirewallD1/config',
                                               'org.fedoraproject.FirewallD1.config',
                                               'getZoneByName', [zone]))
            .then(path => firewalld_dbus.call(path[0], 'org.fedoraproject.FirewallD1.config.zone',
                                              'removeService', [service]));
};

/*
 * Create new firewalld service.
 *
 * Returns a promise that resolves when the service is created.
 * It will also reload firewalld and enable the new service.
 */
firewall.createService = (service, ports, zones, desc = "") => {
    const subscription = firewalld_dbus.subscribe({
        interface: 'org.fedoraproject.FirewallD1',
        path: '/org/fedoraproject/FirewallD1',
        member: 'Reloaded'
    }, () => {
        firewall.addServices(zones, [service]);
        subscription.remove();
    });
    return firewalld_dbus.call('/org/fedoraproject/FirewallD1/config',
                               'org.fedoraproject.FirewallD1.config',
                               'addService2', [service, { description: { t: 's', v: desc }, ports: { t: 'a(ss)', v: ports } }])
            .then(() => firewall.reload());
};

/*
 * Edit firewalld service.
 *
 * Returns a promise that resolves when the service is edited.
 */
firewall.editService = (service, ports, desc = "") => {
    return firewalld_dbus.call('/org/fedoraproject/FirewallD1/config',
                               'org.fedoraproject.FirewallD1.config',
                               'getServiceByName', [service])
            .then(path => firewalld_dbus.call(path[0],
                                              'org.fedoraproject.FirewallD1.config.service',
                                              'update2', [{ description: { t: 's', v: desc }, ports: { t: 'a(ss)', v: ports } }])
                    .then(() => {
                        // No signal for updated service so we need to manually update it
                        firewall.services[service].description = desc;
                        firewall.services[service].ports = ports.map(port => ({ port: port[0], protocol: port[1] }));
                        firewall.debouncedEvent('changed');
                        return firewall.reload();
                    })
            );
};

/*
 * Add a predefined firewalld service to the specified zone (i.e., open its
 * ports).
 *
 * Returns a promise that resolves when the service is added.
 */
firewall.addService = (zone, service) => {
    return firewalld_dbus.call('/org/fedoraproject/FirewallD1',
                               'org.fedoraproject.FirewallD1.zone',
                               'addService', [zone, service, 0])
            .then(reply => firewalld_dbus.call('/org/fedoraproject/FirewallD1/config',
                                               'org.fedoraproject.FirewallD1.config',
                                               'getZoneByName', [zone]))
            .then(path => firewalld_dbus.call(path[0], 'org.fedoraproject.FirewallD1.config.zone',
                                              'addService', [service]));
};

/*
 * Like addService(), but adds multiple predefined firewalld services at once
 * to the specified zones.
 *
 * Returns a promise that resolves when all services are added.
 */
firewall.addServices = (zone, services) =>
    Promise.all(services.map(s => firewall.addService(zone, s)));

firewall.removeServiceFromZones = (zones, service) =>
    Promise.all(zones.map(z => firewall.removeService(z, service)));

firewall.activateZone = (zone, interfaces, sources) => {
    let promises = interfaces.map(i => firewalld_dbus.call('/org/fedoraproject/FirewallD1',
                                                           'org.fedoraproject.FirewallD1.zone',
                                                           'addInterface', [zone, i]));

    promises = promises.concat(sources.map(s => firewalld_dbus.call('/org/fedoraproject/FirewallD1',
                                                                    'org.fedoraproject.FirewallD1.zone',
                                                                    'addSource', [zone, s])));
    let p = Promise.all(promises).then(() => firewalld_dbus.call('/org/fedoraproject/FirewallD1/config',
                                                                 'org.fedoraproject.FirewallD1.config',
                                                                 'getZoneByName', [zone]));
    p = p.then(path => {
        /* Once this signal is received, it's safe to actually emit the changed
         * signal and thus update the UI */
        const subscription = firewalld_dbus.subscribe({
            interface: 'org.fedoraproject.FirewallD1.config.zone',
            path: path[0],
            member: 'Updated'
        }, (path, iface, signal, args) => {
            getZones().then(() => getServices());
            subscription.remove();
        });

        return firewalld_dbus.call(path[0],
                                   'org.fedoraproject.FirewallD1.config.zone',
                                   'update2', [{ interfaces: { t: 'as', v: interfaces }, sources: { t: 'as', v: sources } }]);
    });
    return p;
};

/*
 * A zone is considered deactivated when it has no interfaces or sources.
 */
firewall.deactiveateZone = (zone) => {
    const zoneObject = firewall.zones[zone];
    let promises = zoneObject.interfaces.map(i => firewalld_dbus.call('/org/fedoraproject/FirewallD1',
                                                                      'org.fedoraproject.FirewallD1.zone',
                                                                      'removeInterface', [zone, i]));
    promises = promises.concat(zoneObject.source.map(s => firewalld_dbus.call('/org/fedoraproject/FirewallD1',
                                                                              'org.fedoraproject.FirewallD1.zone',
                                                                              'removeSource', [zone, s])));
    let p = Promise.all(promises).then(() => firewalld_dbus.call('/org/fedoraproject/FirewallD1/config',
                                                                 'org.fedoraproject.FirewallD1.config',
                                                                 'getZoneByName', [zone]));
    p = p.then(path => {
        /* Once this signal is received, it's safe to actually emit the changed
         * signal and thus update the UI */
        const subscription = firewalld_dbus.subscribe({
            interface: 'org.fedoraproject.FirewallD1.config.zone',
            path: path[0],
            member: 'Updated'
        }, (path, iface, signal, args) => {
            firewall.activeZones.delete(args[0]);
            getZones().then(() => getServices());
            subscription.remove();
        });

        return firewalld_dbus.call(path[0],
                                   'org.fedoraproject.FirewallD1.config.zone',
                                   'update2', [{ interfaces: { t: 'as', v: [] }, sources: { t: 'as', v: [] } }]);
    });

    return p.catch(error => console.warn(error));
};

export default firewall;
