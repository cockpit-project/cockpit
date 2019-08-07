export function getDiskXML(poolName, volumeName, format, target, cacheMode) {
    var doc = document.implementation.createDocument('', '', null);

    var diskElem = doc.createElement('disk');
    diskElem.setAttribute('type', 'volume');
    diskElem.setAttribute('device', 'disk');

    var driverElem = doc.createElement('driver');
    driverElem.setAttribute('name', 'qemu');
    if (format && ['qcow2', 'raw'].includes(format))
        driverElem.setAttribute('type', format);
    driverElem.setAttribute('cache', cacheMode);
    diskElem.appendChild(driverElem);

    var sourceElem = doc.createElement('source');
    sourceElem.setAttribute('volume', volumeName);
    sourceElem.setAttribute('pool', poolName);
    diskElem.appendChild(sourceElem);

    var targetElem = doc.createElement('target');
    targetElem.setAttribute('dev', target);
    targetElem.setAttribute('bus', 'virtio');
    diskElem.appendChild(targetElem);

    doc.appendChild(diskElem);

    return new XMLSerializer().serializeToString(doc.documentElement);
}

export function getNetworkXML({ name, forwardMode, physicalDevice, ipv4, netmask, ipv6, prefix, ipv4DhcpRangeStart, ipv4DhcpRangeEnd, ipv6DhcpRangeStart, ipv6DhcpRangeEnd }) {
    let doc = document.implementation.createDocument('', '', null);

    let networkElem = doc.createElement('network');

    let nameElem = doc.createElement('name');
    nameElem.appendChild(doc.createTextNode(name));
    networkElem.appendChild(nameElem);

    if (forwardMode !== 'none') {
        let forwardElem = doc.createElement('forward');
        forwardElem.setAttribute('mode', forwardMode);
        if ((forwardMode === 'nat' || forwardMode === 'route') && physicalDevice !== 'automatic')
            forwardElem.setAttribute('dev', physicalDevice);
        networkElem.appendChild(forwardElem);
    }

    if (forwardMode === 'none' ||
        forwardMode === 'nat' ||
        forwardMode === 'route' ||
        forwardMode === 'open') {
        let domainElem = doc.createElement('domain');
        domainElem.setAttribute('name', name);
        networkElem.appendChild(domainElem);
    }

    if (ipv4) {
        let ipElem = doc.createElement('ip');
        ipElem.setAttribute('address', ipv4);
        ipElem.setAttribute('netmask', netmask);
        networkElem.appendChild(ipElem);

        if (ipv4DhcpRangeStart) {
            let dhcpElem = doc.createElement('dhcp');
            ipElem.appendChild(dhcpElem);

            let rangeElem = doc.createElement('range');
            rangeElem.setAttribute('start', ipv4DhcpRangeStart);
            rangeElem.setAttribute('end', ipv4DhcpRangeEnd);
            dhcpElem.appendChild(rangeElem);
        }
    }

    if (ipv6) {
        let ipv6Elem = doc.createElement('ip');
        ipv6Elem.setAttribute('family', 'ipv6');
        ipv6Elem.setAttribute('address', ipv6);
        ipv6Elem.setAttribute('prefix', prefix);
        networkElem.appendChild(ipv6Elem);

        if (ipv6DhcpRangeStart) {
            let dhcpElem = doc.createElement('dhcp');
            ipv6Elem.appendChild(dhcpElem);

            let rangeElem = doc.createElement('range');
            rangeElem.setAttribute('start', ipv6DhcpRangeStart);
            rangeElem.setAttribute('end', ipv6DhcpRangeEnd);
            dhcpElem.appendChild(rangeElem);
        }
    }

    doc.appendChild(networkElem);

    return new XMLSerializer().serializeToString(doc.documentElement);
}

export function getVolumeXML(volumeName, size, format, target) {
    var doc = document.implementation.createDocument('', '', null);

    var volElem = doc.createElement('volume');
    volElem.setAttribute('type', 'file');

    var nameElem = doc.createElement('name');
    nameElem.appendChild(doc.createTextNode(volumeName));
    volElem.appendChild(nameElem);

    var allocationElem = doc.createElement('capacity');
    allocationElem.setAttribute('unit', 'MB');
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
    let doc = document.implementation.createDocument('', '', null);

    let poolElem = doc.createElement('pool');
    poolElem.setAttribute('type', type);

    let nameElem = doc.createElement('name');
    nameElem.appendChild(doc.createTextNode(name));
    poolElem.appendChild(nameElem);

    if (target) {
        let targetElem = doc.createElement('target');
        let pathElem = doc.createElement('path');
        pathElem.appendChild(doc.createTextNode(target));
        targetElem.appendChild(pathElem);
        poolElem.appendChild(targetElem);
    }

    let sourceElem = doc.createElement('source');
    if (source.dir) {
        let dirElem = doc.createElement('dir');

        dirElem.setAttribute('path', source.dir);
        sourceElem.appendChild(dirElem);
    }
    if (source.device) {
        let deviceElem = doc.createElement('device');

        deviceElem.setAttribute('path', source.device);
        sourceElem.appendChild(deviceElem);
    }
    if (source.name) {
        let sourceNameElem = doc.createElement('name');

        sourceNameElem.appendChild(doc.createTextNode(source.name));
        sourceElem.appendChild(sourceNameElem);
    }
    if (source.host) {
        let hostElem = doc.createElement('host');

        hostElem.setAttribute('name', source.host);
        sourceElem.appendChild(hostElem);
    }
    if (source.initiator) {
        let initiatorElem = doc.createElement('initiator');
        let iqnElem = doc.createElement('iqn');

        iqnElem.setAttribute('name', source.initiator);
        initiatorElem.appendChild(iqnElem);
        sourceElem.appendChild(initiatorElem);
    }
    if (source.format) {
        let formatElem = doc.createElement('format');

        formatElem.setAttribute('type', source.format);
        sourceElem.appendChild(formatElem);
    }
    if (source.host || source.dir || source.device || source.name || source.initiator || source.format)
        poolElem.appendChild(sourceElem);

    doc.appendChild(poolElem);

    return new XMLSerializer().serializeToString(doc.documentElement);
}
