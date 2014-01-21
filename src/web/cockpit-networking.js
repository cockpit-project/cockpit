/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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

PageNetworking.prototype = {
    _init: function () {
        this.id = "networking";
        this._interfaceProxies = {};
    },

    getInterfaceProxy: function(ifname) {
        return this._interfaceProxies[ifname];
    },

    getTitle: function() {
        return C_("page-title", "Networking");
    },

    _set_subtract: function (a, b) {
        var result = {};
        for (var k in a) {
            if (!b[k])
                result[k] = true;
        }
        return result;
    },

    _resync_network_interface_list: function () {
        var manager = cockpit_dbus_client.lookup("/com/redhat/Cockpit/Network", "com.redhat.Cockpit.Network");
        var listContainer = $("#networking_content").get(0);

        var newInterfaceProxies = cockpit_dbus_client.getInterfacesFrom("/com/redhat/Cockpit/Network/",
                                                                    "com.redhat.Cockpit.Network.Netinterface");
        var newInterfaceProxyIndexes = {};

        var ifname, i, proxy, node, parent;

        for (i = 0; i < newInterfaceProxies.length; i++) {
            proxy = newInterfaceProxies[i];
            ifname = proxy['Name'];
            newInterfaceProxyIndexes[ifname] = true;
        }
        var currentInterfaceProxyIndexes = {};
        for (ifname in this._interfaceProxies) {
            currentInterfaceProxyIndexes[ifname] = true;
        }

        var deletedProxyIndexes = this._set_subtract(currentInterfaceProxyIndexes, newInterfaceProxyIndexes);

        for (ifname in deletedProxyIndexes) {
            proxy = this._interfaceProxies[ifname];
            delete this._interfaceProxies[ifname];
            $(proxy).off("notify");
            node = $("#networking-interface-" + ifname).get(0);
            parent = node.parentNode;
            parent.removeChild(node);
        }

        var addedProxyIndexes = this._set_subtract(newInterfaceProxyIndexes, currentInterfaceProxyIndexes);

        var match, insertBefore, interfaces, top, topA, header, ifaceContent;

        for (ifname in addedProxyIndexes) {
            match = $.grep(newInterfaceProxies, function (v) {
                return v['Name'] == ifname;
            });
            proxy = match[0];
            if (!proxy)
                throw Error("no matching proxy for " + ifname);
            this._interfaceProxies[ifname] = proxy;
            $(proxy).on("notify", $.proxy(this._on_iface_notify, this));

            insertBefore = null;
            interfaces = $(".networking-interface").each(function (i, node) {
                if (insertBefore === null) {
                    var cur_ifname = node._ifname;
                    if (cur_ifname > ifname) {
                        insertBefore = node;
                    }
                }
            });

            top = document.createElement("li");
            top.setAttribute("id", "networking-interface-" + ifname);
            top.classList.add("networking-interface");
            top._ifname = ifname; // expando

            topA = document.createElement("a");
            top.appendChild(topA);

            topA.setAttribute("onclick", cockpit_go_down_cmd("networking-iface", { ifname: ifname }));
            header = document.createElement("div");
            header.classList.add("cockpit-network-header");
            header.appendChild(document.createTextNode(proxy['Name']));
            topA.appendChild(header);
            ifaceContent = document.createElement("div");
            ifaceContent.setAttribute("id", "networking_interface_content_" + ifname);
            topA.appendChild(ifaceContent);

            ifaceContent.appendChild(document.createTextNode("Loading..."));

            if (insertBefore)
                listContainer.insertBefore(top, insertBefore);
            else
                listContainer.appendChild(top);
        }

        this._resync_network_interface_list_content();
        $("#networking_content").listview('refresh');
    },

    _ip4AddressToHTML: function (address) {
        var addrlen = 4;
        var p = document.createElement("span");
        var i;
        var text;
        var addressString;

        for (i = 0; i < addrlen; i++) {
            addressString = address[i].toString(10);
            text = document.createTextNode(addressString);
            p.appendChild(text);
            if (i < addrlen - 1)
                    p.appendChild(document.createTextNode('.'));
        }
        p.appendChild(document.createTextNode('/'));
        text = document.createTextNode(address[4]);
        p.appendChild(text);
        return p;

    },

    _ip6AddressToHTML: function (address) {
        var addrlen = 16;
        var p = document.createElement("span");
        var i;
        var text;
        var firstByte, secondByte;

        for (i = 0; i < addrlen; i += 2) {
            firstByte = address[i].toString(16);
            if (firstByte.length == 1)
                firstByte = "0" + firstByte;
            p.appendChild(document.createTextNode(firstByte));
            secondByte = address[i+1].toString(16);
            if (secondByte.length == 1)
                secondByte = "0" + secondByte;
            p.appendChild(document.createTextNode(secondByte));
            if (i < addrlen - 2)
                    p.appendChild(document.createTextNode(':'));
        }
        p.appendChild(document.createTextNode('/'));
        text = document.createTextNode(address[address.length - 1]);
        p.appendChild(text);
        return p;
    },

    _resync_network_interface_list_content: function () {
        var manager = cockpit_dbus_client.lookup("/com/redhat/Cockpit/Network", "com.redhat.Cockpit.Network");
        var i, j, ifname, proxy, content, ip4Addresses, ip6Addresses;
        var table, tr, td;

        for (ifname in this._interfaceProxies) {
            proxy = this._interfaceProxies[ifname];
            content = $("#networking_interface_content_" + ifname).get(0);

            $(content).empty();

            ip4Addresses = proxy['IP4Addresses'];
            ip6Addresses = proxy['IP6Addresses'];

            table = document.createElement('table');
            table.classList.add("cockpit-form-table");
            content.appendChild(table);

            tr = document.createElement('tr');
            table.appendChild(tr);
            td = document.createElement('td');
            tr.appendChild(td);
            td.appendChild(document.createTextNode("Hardware Address"));
            td = document.createElement('td');
            td.appendChild(document.createTextNode(proxy['HwAddress']));
            tr.appendChild(td);

            tr = document.createElement('tr');
            table.appendChild(tr);
            td = document.createElement('td');
            tr.appendChild(td);
            td.appendChild(document.createTextNode("IP Addresses"));

            for (j = 0; j < ip4Addresses.length; j++) {
                td = document.createElement('td');
                tr.appendChild(td);
                td.appendChild(this._ip4AddressToHTML(ip4Addresses[j]));

                tr = document.createElement('tr');
                table.appendChild(tr);
                td = document.createElement('td');
                tr.appendChild(td);
            }

            for (j = 0; j < ip6Addresses.length; j++) {
                td = document.createElement('td');
                tr.appendChild(td);
                td.appendChild(this._ip6AddressToHTML(ip6Addresses[j]));

                tr = document.createElement('tr');
                table.appendChild(tr);
                td = document.createElement('td');
                tr.appendChild(td);
            }

            td = document.createElement('td');
            tr.appendChild(td);
        }
    },

    _on_iface_notify: function (event) {
        var iface = event.target;
        this._resync_network_interface_list_content();
    },

    _resync_if_netinterface_changed: function (event, obj) {
        if (obj.objectPath.indexOf('/com/redhat/Cockpit/Network/') === 0)
            this._resync_network_interface_list();
    },

    enter: function (first_visit) {
        if (first_visit) {
            $(cockpit_dbus_client).on("objectAdded", $.proxy(this._resync_if_netinterface_changed, this));
            $(cockpit_dbus_client).on("objectRemoved", $.proxy(this._resync_if_netinterface_changed, this));
            this._resync_network_interface_list();
        }
    },

    show: function() {
        $("#networking_content").listview('refresh');
    },

    leave: function() {
    }
};

function PageNetworking() {
    this._init();
}

cockpit_pages.push(new PageNetworking());

PageNetworkingIface.prototype = {
    _init: function () {
        this.id = "networking-iface";
    },

    getTitle: function() {
        return C_("page-title", "Network Interface");
    },

    enter: function (first_visit) {
        var ifname = cockpit_get_page_param("ifname");
        if (!ifname)
            return;

        var networkingPage = cockpit_page_from_id("networking");
        var proxy = networkingPage.getInterfaceProxy(ifname);

        $("#networking_iface_config_ip4_text").text(proxy['IP4ConfigMode']);
        $("#networking_iface_config_ip6_text").text(proxy['IP6ConfigMode']);
    },

    show: function() {
    },

    leave: function() {
    }
};

function PageNetworkingIface() {
    this._init();
}

cockpit_pages.push(new PageNetworkingIface());
