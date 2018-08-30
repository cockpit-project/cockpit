export function getDiskXML(diskFileName, target) {
    var doc = document.implementation.createDocument('', '', null);

    var diskElem = doc.createElement('disk');
    diskElem.setAttribute('type', 'file');
    diskElem.setAttribute('device', 'disk');

    var sourceElem = doc.createElement('source');
    sourceElem.setAttribute('file', diskFileName);
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
