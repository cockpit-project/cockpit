import {
    vmActionFailed
} from './actions.es6';

import {
    logDebug,
} from './helpers.es6';

/**
 * Returns a function handling VM action failures.
 */
export function buildFailHandler({ dispatch, name, connectionName, message, extraPayload }) {
    return ({ exception, data }) =>
        dispatch(vmActionFailed({
            name,
            connectionName,
            message,
            detail: {
                exception,
                data,
            },
            extraPayload,
        }));
}

export function buildScriptTimeoutFailHandler(args, delay) {
    let handler = buildFailHandler(args);
    return ({ message, exception }) => {
        window.setTimeout(() => {
            handler({
                exception: exception || message,
            });
        }, delay);
    };
}

export function parseDumpxmlForConsoles(devicesElem) {
    const displays = {};
    const graphicsElems = devicesElem.getElementsByTagName("graphics");
    if (graphicsElems) {
        for (let i = 0; i < graphicsElems.length; i++) {
            const graphicsElem = graphicsElems[i];
            const display = {
                type: graphicsElem.getAttribute('type'),
                port: graphicsElem.getAttribute('port'),
                tlsPort: graphicsElem.getAttribute('tlsPort'),
                address: graphicsElem.getAttribute('listen'),
                autoport: graphicsElem.getAttribute('autoport'),
            };
            if (display.type &&
                (display.autoport ||
                (display.address && (display.port || display.tlsPort)))) {
                displays[display.type] = display;
                logDebug(`parseDumpxmlForConsoles(): graphics device found: ${JSON.stringify(display)}`);
            } else {
                console.warn(`parseDumpxmlForConsoles(): mandatory properties are missing in dumpxml, found: ${JSON.stringify(display)}`);
            }
        }
    }

    // console type='pty'
    const consoleElems = devicesElem.getElementsByTagName("console");
    if (consoleElems) {
        for (let i = 0; i < consoleElems.length; i++) {
            const consoleElem = consoleElems[i];
            if (consoleElem.getAttribute('type') === 'pty') {
                // Definition of serial console is detected.
                // So far no additional details needs to be parsed since the console is accessed via 'virsh console'.
                displays['pty'] = {};
            }
        }
    }

    return displays;
}
