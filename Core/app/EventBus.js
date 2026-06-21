const EventEmitter = require('events');
const Log = require('../util/Logger');

class EventBus extends EventEmitter {
    constructor() {
        super();
    }

    /**
     * Add logging to emitted events for better visibility during development and debugging. This will log the event name and data whenever an event is emitted.
     * 
     */
    emit(eventName, eventData) {
        if (process.env.ENABLE_APP_LOGGING === 'true') {
            console.log(`[EventBus] Emitting event: ${eventName} with data:`, eventData);
        }
        super.emit(eventName, eventData);
    }



}

module.exports = EventBus;