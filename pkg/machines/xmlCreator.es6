export function getDiskXML(poolName, volumeName, target) {
    var doc = document.implementation.createDocument('', '', null);

    var diskElem = doc.createElement('disk');
    diskElem.setAttribute('type', 'volume');
    diskElem.setAttribute('device', 'disk');

    var sourceElem = doc.createElement('source');
    sourceElem.setAttribute('volume', volumeName);
    sourceElem.setAttribute('pool', poolName);
    diskElem.appendChild(sourceElem);

    var targetElem = doc.createElement('target');
    targetElem.setAttribute('dev', target);
    diskElem.appendChild(targetElem);

    doc.appendChild(diskElem);

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

    var formatElem = doc.createElement('format');
    formatElem.setAttribute('type', format);
    targetElem.appendChild(formatElem);

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

    let targetElem = doc.createElement('target');
    let pathElem = doc.createElement('path');
    pathElem.appendChild(doc.createTextNode(target));
    targetElem.appendChild(pathElem);
    poolElem.appendChild(targetElem);

    let sourceElem = doc.createElement('source');
    if (source.dir) {
        let dirElem = doc.createElement('dir');

        dirElem.setAttribute('path', source.dir);
        sourceElem.appendChild(dirElem);
    }
    if (source.host) {
        let hostElem = doc.createElement('host');

        hostElem.setAttribute('name', source.host);
        sourceElem.appendChild(hostElem);
    }
    if (source.host || source.dir)
        poolElem.appendChild(sourceElem);

    doc.appendChild(poolElem);

    return new XMLSerializer().serializeToString(doc.documentElement);
}
