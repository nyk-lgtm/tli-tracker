/**
 * Qt WebChannel Bridge Adapter
 *
 * Bridges QWebChannel to the existing app.js API interface.
 * Replaces pywebview's js_api with Qt's QWebChannel.
 */

// Bridge state
let apiReady = false;
let apiReadyResolve = null;

// Promise that resolves when the bridge is ready
const apiReadyPromise = new Promise((resolve) => {
    apiReadyResolve = resolve;
});

/**
 * Initialize the Qt WebChannel bridge
 */
function initQtBridge() {
    if (typeof qt === 'undefined' || typeof QWebChannel === 'undefined') {
        console.warn('Qt WebChannel not available');
        return;
    }

    new QWebChannel(qt.webChannelTransport, function(channel) {
        // Store the bridge object globally
        window.bridge = channel.objects.api;

        // Listen to Python events
        window.bridge.pythonEvent.connect(function(eventType, jsonData) {
            try {
                const data = JSON.parse(jsonData);
                if (window.onPythonEvent) {
                    window.onPythonEvent(eventType, data);
                }
            } catch (e) {
                console.error('Error parsing Python event:', e);
            }
        });

        apiReady = true;
        if (apiReadyResolve) {
            apiReadyResolve();
        }

        console.log('Qt WebChannel bridge initialized');
    });
}

/**
 * Wait for the API to be ready
 * Compatible with existing waitForApi() pattern
 */
async function waitForApi() {
    if (apiReady) {
        return Promise.resolve();
    }
    return apiReadyPromise;
}

/**
 * Call a Python API method
 * Compatible with existing api() function signature
 *
 * @param {string} method - The method name to call
 * @param {...any} args - Arguments to pass to the method
 * @returns {Promise<any>} - The result from Python
 */
async function api(method, ...args) {
    await waitForApi();

    return new Promise((resolve, reject) => {
        if (!window.bridge) {
            reject(new Error('Bridge not initialized'));
            return;
        }

        if (!window.bridge[method]) {
            reject(new Error(`Method ${method} not found on bridge`));
            return;
        }

        try {
            // QWebChannel methods return via callback
            // Some methods take arguments, some don't
            const bridgeMethod = window.bridge[method];

            // Handle methods with different argument counts
            // Arguments need to be serialized for methods that expect JSON
            if (args.length === 0) {
                bridgeMethod(function(result) {
                    resolve(parseResult(result));
                });
            } else if (args.length === 1) {
                // Check if arg needs to be JSON stringified (for objects)
                const arg = typeof args[0] === 'object'
                    ? JSON.stringify(args[0])
                    : args[0];
                bridgeMethod(arg, function(result) {
                    resolve(parseResult(result));
                });
            } else if (args.length === 2) {
                const arg1 = typeof args[0] === 'object'
                    ? JSON.stringify(args[0])
                    : args[0];
                const arg2 = typeof args[1] === 'object'
                    ? JSON.stringify(args[1])
                    : args[1];
                bridgeMethod(arg1, arg2, function(result) {
                    resolve(parseResult(result));
                });
            } else {
                reject(new Error(`Too many arguments: ${args.length}`));
            }
        } catch (e) {
            console.error(`API error (${method}):`, e);
            reject(e);
        }
    });
}

/**
 * Parse result from Python (always JSON string)
 */
function parseResult(result) {
    if (typeof result === 'string') {
        try {
            return JSON.parse(result);
        } catch (e) {
            return result;
        }
    }
    return result;
}

// Initialize bridge when Qt is available
if (typeof qt !== 'undefined') {
    initQtBridge();
} else {
    // For development/testing in regular browser
    console.warn('Qt bridge not available - running in browser mode');
}
