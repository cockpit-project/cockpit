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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

import cockpit from 'cockpit';
import * as service from 'service';
import { debounce } from 'throttle-debounce';
import * as utils from './utils';

var firewall = {
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
};

cockpit.event_target(firewall);

utils.list_interfaces().then(interfaces => {
    firewall.availableInterfaces = interfaces;
});

const firewalld_service = service.proxy('firewalld');
var firewalld_dbus = null;

function initFirewalldDbus() {
    firewalld_dbus = cockpit.dbus('org.fedoraproject.FirewallD1', { superuser: "try" });

    firewalld_dbus.addEventListener('owner', (event, owner) => {
        firewall.enabled = !!owner;

        firewall.services = {};
        firewall.enabledServices = new Set();

        if (!firewall.enabled) {
            firewall.dispatchEvent('changed');
            return;
        }

        /* As certain dbus signal callbacks might change the firewall frequently
         * in a short period of time, prevent rapid succession of renders by
         * debouncing the ('changed') event */
        firewall.debouncedEvent = debounce(300, event => firewall.dispatchEvent(event));

        /* As a service might be removed from multiple zones at the same time,
         * prevent rapid succession of GetServices call */
        firewall.debouncedGetServices = debounce(300, getServices);

        firewall.debouncedGetZones = debounce(300, () => {
            getZones()
                    .then(() => getServices())
                    .catch(error => console.warn(error));
        });

        getZones()
                .then(() => getServices())
                .catch(error => console.warn(error));
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

    /* HACK: cockpit.dbus() remains dead for non-activatable names, so reinitialize it if the service gets enabled and started
     * See https://github.com/cockpit-project/cockpit/pull/9125 */
    if (!firewall.enabled && firewalld_service.state == 'running')
        initFirewalldDbus();

    if (firewall.installed == installed)
        return;

    firewall.installed = installed;
    firewall.dispatchEvent('changed');
});

function getZones() {
    return firewalld_dbus.call('/org/fedoraproject/FirewallD1',
                               'org.fedoraproject.FirewallD1.zone',
                               'getActiveZones', [])
            .then(reply => fetchZoneInfos(Object.keys(reply[0])))
            .then(zones => {
                firewall.activeZones = new Set(zones.map(z => z.id));
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
    })).then(() => firewall.debouncedEvent('changed'));
}

function fetchServiceInfos(services) {
    return Promise.all(services.map(service => {
        if (firewall.services[service])
            return firewall.services[service];

        let info;
        return firewalld_dbus.call('/org/fedoraproject/FirewallD1',
                                   'org.fedoraproject.FirewallD1',
                                   'getServiceSettings', [service])
                .then(reply => {
                    const name = reply[0][1];
                    const description = reply[0][2];
                    const ports = reply[0][3];
                    info = {
                        id: service,
                        name: name,
                        description: description,
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
                    Promise.reject(error);
                });
    }));
}

function fetchZoneInfos(zones) {
    return Promise.all(zones.map(zone => {
        return firewalld_dbus.call('/org/fedoraproject/FirewallD1',
                                   'org.fedoraproject.FirewallD1',
                                   'getZoneSettings', [zone])
                .then(reply => {
                    const [, name, description, , target, services, ports, , , , interfaces, source] = reply[0];
                    const info = {
                        id: zone,
                        name: name,
                        description: description,
                        target: target,
                        services: services,
                        ports: ports.map(p => ({ port: p[0], protocol: p[1] })),
                        interfaces: interfaces,
                        source: source,
                    };
                    firewall.zones[zone] = info;
                    return info;
                });
    }));
}

initFirewalldDbus();

cockpit.spawn(['sh', '-c', 'pkcheck --action-id org.fedoraproject.FirewallD1.all --process $$ --allow-user-interaction 2>&1'])
        .done(() => {
            firewall.readonly = false;
            firewall.dispatchEvent('changed');
        });

firewall.enable = () => Promise.all([firewalld_service.enable(), firewalld_service.start()]);

firewall.disable = () => Promise.all([firewalld_service.stop(), firewalld_service.disable()]);

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
firewall.createService = (service, name, ports, zones) => {
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
                               'addService', [service, ["", name, "", ports, [], {}, [], []]])
            .then(() => firewall.reload());
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
firewall.addServices = (zones, services) =>
    Promise.all(zones.map(z => services.map(s => firewall.addService(z, s))));

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
                                   'getSettings', [])
                .then(settings => {
                    settings[0][10] = interfaces;
                    settings[0][11] = sources;
                    return firewalld_dbus.call(path[0],
                                               'org.fedoraproject.FirewallD1.config.zone',
                                               'update', [settings[0]]);
                });
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
                                   'getSettings', [])
                .then(settings => {
                    settings[0][10] = [];
                    settings[0][11] = [];
                    return firewalld_dbus.call(path[0],
                                               'org.fedoraproject.FirewallD1.config.zone',
                                               'update', [settings[0]]);
                });
    });

    return p.catch(error => console.warn(error));
};

export default firewall;
