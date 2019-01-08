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

var firewall = {
    installed: true,
    enabled: false,
    readonly: true,
    services: {},
    enabledServices: new Set()
};

cockpit.event_target(firewall);

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

        firewalld_dbus.call('/org/fedoraproject/FirewallD1',
                            'org.fedoraproject.FirewallD1.zone',
                            'getServices', [''])
                .then(reply => fetchServiceInfos(reply[0]))
                .then(services => services.map(s => firewall.enabledServices.add(s.id)))
                .then(() => firewall.dispatchEvent('changed'))
                .catch(error => console.warn(error));
    });

    firewalld_dbus.subscribe({
        interface: 'org.fedoraproject.FirewallD1.zone',
        path: '/org/fedoraproject/FirewallD1',
        member: 'ServiceAdded'
    }, (path, iface, signal, args) => {
        const service = args[1];

        fetchServiceInfos([service])
                .then(info => {
                    firewall.enabledServices.add(info[0].id);
                    firewall.dispatchEvent('changed');
                })
                .catch(error => console.warn(error));
    });

    firewalld_dbus.subscribe({
        interface: 'org.fedoraproject.FirewallD1.zone',
        path: '/org/fedoraproject/FirewallD1',
        member: 'ServiceRemoved'
    }, (path, iface, signal, args) => {
        const service = args[1];

        firewall.enabledServices.delete(service);
        firewall.dispatchEvent('changed');
    });
}

firewalld_service.addEventListener('changed', () => {
    let installed = !!firewalld_service.exists;

    /* HACK: cockpit.dbus() remains dead for non-activatable names, so reinitialize it if the service gets enabled and started
     * See https://github.com/cockpit-project/cockpit/pull/9125 */
    if (!firewall.enabled && firewalld_service.state == 'running')
        initFirewalldDbus();

    if (firewall.installed == installed)
        return;

    firewall.installed = installed;
    firewall.dispatchEvent('changed');
});

function fetchServiceInfos(services) {
    var promises = cockpit.all(services.map(service => {
        if (firewall.services[service])
            return firewall.services[service];

        return firewalld_dbus.call('/org/fedoraproject/FirewallD1',
                                   'org.fedoraproject.FirewallD1',
                                   'getServiceSettings', [service])
                .then(reply => {
                    const [ , name, description, ports ] = reply[0];

                    let info = {
                        id: service,
                        name: name,
                        description: description,
                        ports: ports.map(p => ({ port: p[0], protocol: p[1] }))
                    };

                    firewall.services[service] = info;
                    return info;
                });
    }));

    /*
     * Work around `cockpit.all()` returning results in individual arguments -
     * that's just confusing and doesn't work with ES6 style functions.
     */
    return promises.then(function () {
        return Array.prototype.slice.call(arguments);
    });
}

initFirewalldDbus();

cockpit.spawn(['sh', '-c', 'pkcheck --action-id org.fedoraproject.FirewallD1.all --process $$ --allow-user-interaction 2>&1'])
        .done(() => {
            firewall.readonly = false;
            firewall.dispatchEvent('changed');
        });

firewall.enable = () => cockpit.all(firewalld_service.enable(), firewalld_service.start());

firewall.disable = () => cockpit.all(firewalld_service.stop(), firewalld_service.disable());

firewall.getAvailableServices = () => {
    return firewalld_dbus.call('/org/fedoraproject/FirewallD1',
                               'org.fedoraproject.FirewallD1',
                               'listServices', [])
            .then(reply => fetchServiceInfos(reply[0]))
            .catch(error => console.warn(error));
};

function getDefaultZonePath() {
    return firewalld_dbus.call('/org/fedoraproject/FirewallD1',
                               'org.fedoraproject.FirewallD1',
                               'getDefaultZone', [])
            .then(reply => firewalld_dbus.call('/org/fedoraproject/FirewallD1/config',
                                               'org.fedoraproject.FirewallD1.config',
                                               'getZoneByName', [reply[0]]))
            .then(reply => reply[0]);
}

/*
 * Remove a service from the default zone (i.e., close its ports).
 *
 * Returns a promise that resolves when the service is removed.
 */
firewall.removeService = (service) => {
    return firewalld_dbus.call('/org/fedoraproject/FirewallD1',
                               'org.fedoraproject.FirewallD1.zone',
                               'removeService', ['', service])
            .then(reply => getDefaultZonePath())
            .then(path => firewalld_dbus.call(path, 'org.fedoraproject.FirewallD1.config.zone',
                                              'removeService', [service]));
};

/*
 * Add a predefined firewalld service to the default zone (i.e., open its
 * ports).
 *
 * Returns a promise that resolves when the service is added.
 */
firewall.addService = (service) => {
    return firewalld_dbus.call('/org/fedoraproject/FirewallD1',
                               'org.fedoraproject.FirewallD1.zone',
                               'addService', ['', service, 0])
            .then(reply => getDefaultZonePath())
            .then(path => firewalld_dbus.call(path, 'org.fedoraproject.FirewallD1.config.zone',
                                              'addService', [service]));
};

/*
 * Like addService(), but adds multiple predefined firewalld services at once
 * to the default zone.
 *
 * Returns a promise that resolves when all services are added.
 */
firewall.addServices = (services) => {
    return cockpit.all(services.map(s => firewall.addService(s)))
            .then(function () {
                return Array.prototype.slice.call(arguments);
            });
};

export default firewall;
