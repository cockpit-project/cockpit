export function getDiskXML(type, file, device, poolName, volumeName, format, target, cacheMode, shareable, busType) {
    var doc = document.implementation.createDocument('', '', null);

    var diskElem = doc.createElement('disk');
    diskElem.setAttribute('type', type);
    diskElem.setAttribute('device', device);

    var driverElem = doc.createElement('driver');
    driverElem.setAttribute('name', 'qemu');
    if (format && ['qcow2', 'raw'].includes(format))
        driverElem.setAttribute('type', format);
    driverElem.setAttribute('cache', cacheMode);
    diskElem.appendChild(driverElem);

    var sourceElem = doc.createElement('source');
    if (type === 'file') {
        sourceElem.setAttribute('file', file);
    } else {
        sourceElem.setAttribute('volume', volumeName);
        sourceElem.setAttribute('pool', poolName);
    }
    diskElem.appendChild(sourceElem);

    var targetElem = doc.createElement('target');
    targetElem.setAttribute('dev', target);
    targetElem.setAttribute('bus', busType);
    diskElem.appendChild(targetElem);

    if (shareable) {
        const shareableElem = doc.createElement('shareable');
        diskElem.appendChild(shareableElem);
    }

    doc.appendChild(diskElem);

    return new XMLSerializer().serializeToString(doc.documentElement);
}

export function getIfaceXML(sourceType, source, model, mac) {
    const doc = document.implementation.createDocument('', '', null);

    const ifaceElem = doc.createElement('interface');
    ifaceElem.setAttribute('type', sourceType);

    const sourceElem = doc.createElement('source');
    if (sourceType === "network")
        sourceElem.setAttribute('network', source);
    else if (sourceType === "direct")
        sourceElem.setAttribute('dev', source);
    else if (sourceType === "bridge")
        sourceElem.setAttribute('bridge', source);
    ifaceElem.appendChild(sourceElem);

    if (mac) {
        const macElem = doc.createElement('mac');
        macElem.setAttribute('address', mac);
        ifaceElem.appendChild(macElem);
    }

    const modelElem = doc.createElement('model');
    modelElem.setAttribute('type', model);
    ifaceElem.appendChild(modelElem);

    doc.appendChild(ifaceElem);

    return new XMLSerializer().serializeToString(doc.documentElement);
}

export function getNetworkXML({ name, forwardMode, device, ipv4, netmask, ipv6, prefix, ipv4DhcpRangeStart, ipv4DhcpRangeEnd, ipv6DhcpRangeStart, ipv6DhcpRangeEnd }) {
    const doc = document.implementation.createDocument('', '', null);

    const networkElem = doc.createElement('network');

    const nameElem = doc.createElement('name');
    nameElem.appendChild(doc.createTextNode(name));
    networkElem.appendChild(nameElem);

    if (forwardMode !== 'none') {
        const forwardElem = doc.createElement('forward');
        forwardElem.setAttribute('mode', forwardMode);
        if ((forwardMode === 'nat' || forwardMode === 'route') && device !== 'automatic')
            forwardElem.setAttribute('dev', device);
        networkElem.appendChild(forwardElem);
    }

    if (forwardMode === 'none' ||
        forwardMode === 'nat' ||
        forwardMode === 'route' ||
        forwardMode === 'open') {
        const domainElem = doc.createElement('domain');
        domainElem.setAttribute('name', name);
        domainElem.setAttribute('localOnly', 'yes');
        networkElem.appendChild(domainElem);
    }

    if (ipv4) {
        const dnsElem = doc.createElement('dns');
        const hostElem = doc.createElement('host');
        hostElem.setAttribute('ip', ipv4);
        const hostnameElem = doc.createElement('hostname');
        const hostnameTextNode = doc.createTextNode('gateway');
        hostnameElem.appendChild(hostnameTextNode);
        hostElem.appendChild(hostnameElem);
        dnsElem.appendChild(hostElem);
        networkElem.appendChild(dnsElem);

        const ipElem = doc.createElement('ip');
        ipElem.setAttribute('address', ipv4);
        ipElem.setAttribute('netmask', netmask);
        ipElem.setAttribute('localPtr', 'yes');
        networkElem.appendChild(ipElem);

        if (ipv4DhcpRangeStart) {
            const dhcpElem = doc.createElement('dhcp');
            ipElem.appendChild(dhcpElem);

            const rangeElem = doc.createElement('range');
            rangeElem.setAttribute('start', ipv4DhcpRangeStart);
            rangeElem.setAttribute('end', ipv4DhcpRangeEnd);
            dhcpElem.appendChild(rangeElem);
        }
    }

    if (ipv6) {
        const ipv6Elem = doc.createElement('ip');
        ipv6Elem.setAttribute('family', 'ipv6');
        ipv6Elem.setAttribute('address', ipv6);
        ipv6Elem.setAttribute('prefix', prefix);
        networkElem.appendChild(ipv6Elem);

        if (ipv6DhcpRangeStart) {
            const dhcpElem = doc.createElement('dhcp');
            ipv6Elem.appendChild(dhcpElem);

            const rangeElem = doc.createElement('range');
            rangeElem.setAttribute('start', ipv6DhcpRangeStart);
            rangeElem.setAttribute('end', ipv6DhcpRangeEnd);
            dhcpElem.appendChild(rangeElem);
        }
    }

    doc.appendChild(networkElem);

    return new XMLSerializer().serializeToString(doc.documentElement);
}

export function getVolumeXML(volumeName, size, format) {
    var doc = document.implementation.createDocument('', '', null);

    var volElem = doc.createElement('volume');
    volElem.setAttribute('type', 'file');

    var nameElem = doc.createElement('name');
    nameElem.appendChild(doc.createTextNode(volumeName));
    volElem.appendChild(nameElem);

    var allocationElem = doc.createElement('capacity');
    allocationElem.setAttribute('unit', 'MiB');
    allocationElem.appendChild(doc.createTextNode(size));
    volElem.appendChild(allocationElem);

    var targetElem = doc.createElement('target');

    if (format) {
        var formatElem = doc.createElement('format');
        formatElem.setAttribute('type', format);
        targetElem.appendChild(formatElem);
    }

    volElem.appendChild(targetElem);

    doc.appendChild(volElem);

    return new XMLSerializer().serializeToString(doc.documentElement);
}

export function getPoolXML({ name, type, source, target }) {
    const doc = document.implementation.createDocument('', '', null);

    const poolElem = doc.createElement('pool');
    poolElem.setAttribute('type', type);

    const nameElem = doc.createElement('name');
    nameElem.appendChild(doc.createTextNode(name));
    poolElem.appendChild(nameElem);

    if (target) {
        const targetElem = doc.createElement('target');
        const pathElem = doc.createElement('path');
        pathElem.appendChild(doc.createTextNode(target));
        targetElem.appendChild(pathElem);
        poolElem.appendChild(targetElem);
    }

    const sourceElem = doc.createElement('source');
    if (source.dir) {
        const dirElem = doc.createElement('dir');

        dirElem.setAttribute('path', source.dir);
        sourceElem.appendChild(dirElem);
    }
    if (source.device) {
        const deviceElem = doc.createElement('device');

        deviceElem.setAttribute('path', source.device);
        sourceElem.appendChild(deviceElem);
    }
    if (source.name) {
        const sourceNameElem = doc.createElement('name');

        sourceNameElem.appendChild(doc.createTextNode(source.name));
        sourceElem.appendChild(sourceNameElem);
    }
    if (source.host) {
        const hostElem = doc.createElement('host');

        hostElem.setAttribute('name', source.host);
        sourceElem.appendChild(hostElem);
    }
    if (source.initiator) {
        const initiatorElem = doc.createElement('initiator');
        const iqnElem = doc.createElement('iqn');

        iqnElem.setAttribute('name', source.initiator);
        initiatorElem.appendChild(iqnElem);
        sourceElem.appendChild(initiatorElem);
    }
    if (source.format) {
        const formatElem = doc.createElement('format');

        formatElem.setAttribute('type', source.format);
        sourceElem.appendChild(formatElem);
    }
    if (source.host || source.dir || source.device || source.name || source.initiator || source.format)
        poolElem.appendChild(sourceElem);

    doc.appendChild(poolElem);

    return new XMLSerializer().serializeToString(doc.documentElement);
}

export function getSnapshotXML(name, description) {
    const doc = document.implementation.createDocument('', '', null);

    const snapElem = doc.createElement('domainsnapshot');

    if (name) {
        const nameElem = doc.createElement('name');
        nameElem.appendChild(doc.createTextNode(name));
        snapElem.appendChild(nameElem);
    }

    if (description) {
        const descriptionElem = doc.createElement('description');
        descriptionElem.appendChild(doc.createTextNode(description));
        snapElem.appendChild(descriptionElem);
    }

    doc.appendChild(snapElem);

    return new XMLSerializer().serializeToString(doc.documentElement);
}
