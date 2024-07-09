import { is_function, invoke_functions } from './common';

/*
 * Extends an object to have the standard DOM style addEventListener
 * removeEventListener and dispatchEvent methods. The dispatchEvent
 * method has the additional capability to create a new event from a type
 * string and arguments.
 */
export function event_mixin(obj, handlers) {
    Object.defineProperties(obj, {
        addEventListener: {
            enumerable: false,
            value: function addEventListener(type, handler) {
                if (handlers[type] === undefined)
                    handlers[type] = [];
                handlers[type].push(handler);
            }
        },
        removeEventListener: {
            enumerable: false,
            value: function removeEventListener(type, handler) {
                const length = handlers[type] ? handlers[type].length : 0;
                for (let i = 0; i < length; i++) {
                    if (handlers[type][i] === handler) {
                        handlers[type][i] = null;
                        break;
                    }
                }
            }
        },
        dispatchEvent: {
            enumerable: false,
            value: function dispatchEvent(event) {
                let type, args;
                if (typeof event === "string") {
                    type = event;
                    args = Array.prototype.slice.call(arguments, 1);

                    let detail = null;
                    if (arguments.length == 2)
                        detail = arguments[1];
                    else if (arguments.length > 2)
                        detail = args;

                    event = new CustomEvent(type, {
                        bubbles: false,
                        cancelable: false,
                        detail
                    });

                    args.unshift(event);
                } else {
                    type = event.type;
                    args = arguments;
                }
                if (is_function(obj['on' + type]))
                    obj['on' + type].apply(obj, args);
                invoke_functions(handlers[type], obj, args);
            }
        }
    });
}
